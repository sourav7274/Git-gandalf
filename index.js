import { exec } from "child_process";
import { promisify } from "util";
import { readFile } from "fs/promises";
let command = 'git diff --cached --unified=0'

const execAsync = promisify(exec);

async function getStagedChanges() {
  try {
    const { stdout, stderr } = await execAsync(command);
    if (stderr) {
      console.error("stderr:", stderr);
    }
    if (stdout) {
      return stdout;
    }
    return "There are no staged changes.";
  } catch (err) {
    console.error("error:", err.message);
    return null;
  }
}
const codeChanges = await getStagedChanges();
// console.log("Staged code changes:", codeChanges);

// Early exit if no changes - saves LLM call
if (codeChanges === "There are no staged changes.") {
  console.log("✅ No staged changes detected. Commit allowed.");
  process.exit(0);
}


// rules reading
async function readRules(path) {
  try{
    const data = await readFile(path, 'utf8');
    const parsedData = JSON.parse(data);
    return parsedData;
  }
  catch(err){
    console.error("Error reading rules file:", err);
    return [];
  }
}
const myRules = await readRules('rules.json');
// console.log("Loaded rules:", myRules.gitSafetyRules);  




// llm call 
function formatRulesForLLM(rules) {
  return rules
    .map(r => `Rule: ${r.rule}\nDescription: ${r.description}\nSeverity: ${r.severity}`)
    .join('\n\n'); // double newline between rules
}

// Usage
const rulesText = formatRulesForLLM(myRules.gitSafetyRules);
// console.log(rulesText);

const response = await fetch(
  "http://127.0.0.1:1234/v1/chat/completions",
  {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "local-model",
      stream: true,
      messages: [
        { role: "system",
          content: `You are a git security guard. Review code changes against these rules:
${rulesText}

Analyze the code changes first. You can provide a brief explanation or reasoning for your decision.
After your analysis, you MUST output this exact separator line:
--------------

Then, immediately after the separator, output the STRICT JSON object with the verdict. 

Example Output:
Analysis: The code contains a secret...
--------------
{
  "verdict": "BLOCK",
  ...
}

JSON Schema:
{
  "verdict": "PASS" | "BLOCK",
  "severity": "LOW" | "MEDIUM" | "HIGH" | "CRITICAL",
  "summary": "brief description",
  "violations": []
}` },
        { role: "user", 
          content: `I am passing my code changes from my project, 
          there may / maybe not be changes, please let me know 
          if this is safe to commit, and also summarize the changes:
          ${codeChanges}` }
      ]
    })
  }
);

// Stream handling
const reader = response.body.getReader();
const decoder = new TextDecoder("utf-8");
let fullText = "";
let buffer = "";

process.stdout.write("Analyzing changes...\n");

try {
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    
    // Decode chunk and append to buffer
    const chunk = decoder.decode(value, { stream: true });
    buffer += chunk;
    
    // Split buffer by newlines
    const lines = buffer.split('\n');
    
    // Keep the last segment in the buffer (it might be incomplete)
    buffer = lines.pop(); 
    
    for (const line of lines) {
      const trimmedLine = line.trim();
      if (trimmedLine.startsWith('data: ') && trimmedLine !== 'data: [DONE]') {
        try {
          const data = JSON.parse(trimmedLine.slice(6));
          const content = data.choices[0]?.delta?.content || "";
          process.stdout.write(content);
          fullText += content;
        } catch (e) {
          // ignore parse errors for partial chunks (shouldn't happen with buffering)
        }
      }
    }
  }
} catch (err) {
  console.error("Error reading stream:", err);
}

// -------------------------------
// JSON EXTRACTION (robust)
// -------------------------------

// 1. Try splitting by separator
const parts = fullText.split('--------------');
let jsonTextCandidate = parts.length > 1 ? parts[parts.length - 1] : fullText;

// 2. Find JSON object within the candidate text
const jsonStart = jsonTextCandidate.indexOf("{");
if (jsonStart === -1) {
  console.error("\n❌ No JSON found in output. Blocking commit.");
  process.exit(1);
}

// Find matching closing brace
let braceCount = 0;
let jsonEnd = -1;
for (let i = jsonStart; i < jsonTextCandidate.length; i++) {
  if (jsonTextCandidate[i] === '{') braceCount++;
  if (jsonTextCandidate[i] === '}') braceCount--;
  if (braceCount === 0) {
    jsonEnd = i;
    break;
  }
}

if (jsonEnd === -1) {
  console.error("\n❌ No complete JSON found in output. Blocking commit.");
  process.exit(1);
}

const finalJsonText = jsonTextCandidate.slice(jsonStart, jsonEnd + 1);

// ------------------------------------
// PARSE + VALIDATE FINAL JSON
// ------------------------------------
function parseAndValidateFinalJSON(jsonText) {
  let result;

  try {
    result = JSON.parse(jsonText);
  } catch (err) {
    console.error("\n❌ Could not parse JSON at all:");
    console.error(jsonText);
    process.exit(1);
  }

  // ✅ CASE 1: Fully valid schema
  const isValidFinalSchema =
    typeof result === "object" &&
    typeof result.verdict === "string" &&
    typeof result.severity === "string" &&
    typeof result.summary === "string" &&
    Array.isArray(result.violations);

  if (isValidFinalSchema) {
    result.verdict = result.verdict.toUpperCase();
    result.severity = result.severity.toUpperCase();

    if (!["PASS", "BLOCK"].includes(result.verdict)) {
      console.error("\n❌ Invalid verdict value:", result.verdict);
      process.exit(1);
    }

    return result;
  }

  // ⚠️ CASE 2: Looks like a single violation object
  const looksLikeViolation =
    typeof result === "object" &&
    (result.rule || result.description || result.files || result.lines);

  if (looksLikeViolation) {
    console.warn("\n⚠️ Partial LLM response detected. Wrapping into BLOCK.");

    return {
      verdict: "BLOCK",
      severity: "HIGH",
      summary: "Model returned an invalid response format. Treating as violation.",
      violations: [result]
    };
  }

  // ❌ CASE 3: Completely unrecognized structure
  console.error("\n❌ Unrecognized JSON structure from model:");
  console.error(result);
  process.exit(1);
}

// ------------------------------------
// EXECUTION
// ------------------------------------
const result = parseAndValidateFinalJSON(finalJsonText);

// ------------------------------------
// ACT BASED ON VERDICT
// ------------------------------------
if (result.verdict === "BLOCK") {
  console.error("\n🚫 Commit BLOCKED:", result.summary);
  process.exit(1);
}

if (result.verdict === "PASS") {
  console.log("\n✅ Commit ALLOWED:", result.summary);
  process.exit(0);
}

// ------------------------------------
// SAFETY FALLBACK (should never happen)
// ------------------------------------
console.error("\n❌ Unknown verdict. Blocking commit.");
process.exit(1);
