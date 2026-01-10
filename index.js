import { exec } from "child_process";
import { promisify } from "util";
import { readFile } from "fs/promises";
let command = 'git diff --cached --unified=0'

const execAsync = promisify(exec);

let api_key = "dfsdsdfsdfsdf6s987d6f7s6df6s9866s9fguyuyuyfgdfgd"

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
      stream: false,
      messages: [
        { role: "system",
          content: `You are a git security guard. Review code changes against these rules:
${rulesText}

IMPORTANT: If there are no changes, return PASS immediately.

Output ONLY valid JSON (no extra text, no thinking, no separator):
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

// Simple non-streaming response
const data = await response.json();
const fullText = data.choices[0].message.content;

// -------------------------------
// JSON EXTRACTION (robust)
// -------------------------------

// fullText = the FULL streamed text collected from the LLM
// make sure you concatenate all tokens into this string
// e.g. fullText += token;

// More robust JSON extraction - find complete JSON object
let jsonText = "";
let jsonStart = fullText.indexOf("{");

if (jsonStart === -1) {
  console.error("\n❌ No JSON found in output. Blocking commit.");
  process.exit(1);
}

// Find matching closing brace by counting braces
let braceCount = 0;
let jsonEnd = -1;
for (let i = jsonStart; i < fullText.length; i++) {
  if (fullText[i] === '{') braceCount++;
  if (fullText[i] === '}') braceCount--;
  if (braceCount === 0) {
    jsonEnd = i;
    break;
  }
}

if (jsonEnd === -1) {
  console.error("\n❌ No complete JSON found in output. Blocking commit.");
  process.exit(1);
}

jsonText = fullText.slice(jsonStart, jsonEnd + 1);

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
const result = parseAndValidateFinalJSON(jsonText);

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
