import { exec } from "child_process";
import { promisify } from "util";
import { readFile } from "fs/promises";
let command = 'git diff --cached --unified=0'

const execAsync = promisify(exec);
let api_key="23423fsdfsfsfsgfigsfiugy384723urk"
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


// ------------------------------------
// RULE 0 ENFORCEMENT (JS-side, no LLM)
// ------------------------------------
function diffOnlyTouchesSafeFiles(diffText) {
  const touchedFiles = new Set();

  const lines = diffText.split("\n");
  for (const line of lines) {
    if (line.startsWith("+++ b/") || line.startsWith("--- a/")) {
      const file = line.slice(6).trim();
      if (file !== "/dev/null") {
        touchedFiles.add(file);
      }
    }
  }

  // Safety: if we cannot detect files, do NOT bypass LLM
  if (touchedFiles.size === 0) return false;

  for (const file of touchedFiles) {
    if (file !== "index.js" && file !== "rules.json") {
      return false;
    }
  }

  return true;
}
if (diffOnlyTouchesSafeFiles(codeChanges)) {
  console.log("✅ Commit ALLOWED: Only index.js or rules.json changed.");
  process.exit(0);
}




// llm call 
function formatRulesForLLM(rules) {
  return rules
    .map(r => `Rule: ${r.rule}\nDescription: ${r.description}\nSeverity: ${r.severity}`)
    .join('\n\n'); // double newline between rules
}

// Usage
const rulesText = formatRulesForLLM(myRules.gitSafetyRules);
// console.log(rulesText);

let systemPrompt = `
MODE: DETERMINISTIC_SECURITY_ENGINE

You are a Git commit security validator.

You must behave like a strict rule engine.

RULE EXECUTION LOGIC:

1. Read the staged git diff.
2. Evaluate the rules strictly in ascending order of id.
3. If any rule is violated:
   - Immediately stop evaluating further rules.
   - Return verdict BLOCK.
4. If no rule is violated:
   - Return verdict PASS.

SECRET DETECTION RULES:

- Only detect secrets in ADDED lines of the diff (lines starting with +).
- Deletions of secrets are SAFE.

OUTPUT REQUIREMENTS (STRICT):

- Output MUST be exactly ONE JSON object.
- No explanations.
- No reasoning.
- No markdown.
- No text before or after JSON.

JSON SCHEMA:

{
  "verdict": "PASS" | "BLOCK",
  "severity": "LOW" | "MEDIUM" | "HIGH" | "CRITICAL",
  "summary": "short explanation",
  "violations": [
    {
      "rule": "string",
      "description": "string",
      "files": ["string"],
      "lines": [number]
    }
  ]
}

CONSTRAINTS:

If verdict = PASS:
- violations must be []

If verdict = BLOCK:
- violations must contain exactly the rule that failed.

If unsure:
- verdict MUST be BLOCK.

RULES:
${rulesText}
`


console.log("🚀 Calling Ollama...");
const response = await fetch(
  "http://localhost:11434/api/chat",
  {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "mistral",
      stream: true,
      format: "json",
      options: {
        temperature: 0
      },
      messages: [
        {
          role: "system",
          content: systemPrompt
        },
        {
          role: "user",
          content: `Staged git diff:\n${codeChanges}`
        }
      ]
    })
  }
);

console.log("LLM status:", response.status);
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
      try {
        const data = JSON.parse(trimmedLine);

        const content = data.message?.content || "";
        process.stdout.write(content);
        fullText += content;

        if (data.done) break;

      } catch (e) {
        // ignore partial JSON chunks
      }
    }
  }
} catch (err) {
  console.error("Error reading stream:", err);
}

// -------------------------------
// JSON EXTRACTION (robust)
// -------------------------------

// 1. Try splitting by separator (allow variable length dashes)
const parts = fullText.split(/-{3,}/);
// Take the last part that contains a '{' (or just use fullText if no separator)
let jsonTextCandidate = fullText;
if (parts.length > 1) {
    for (let i = parts.length - 1; i >= 0; i--) {
        if (parts[i].includes('{')) {
            jsonTextCandidate = parts[i];
            break;
        }
    }
}

// CLEANUP: Remove Markdown code blocks if present
jsonTextCandidate = jsonTextCandidate.replace(/```json/g, "").replace(/```/g, "");

// 2. Find JSON object within the candidate text
const jsonStart = jsonTextCandidate.indexOf("{");
if (jsonStart === -1) {
  console.error("\n❌ No JSON found in output. Blocking commit.");
  console.error("DEBUG: fullText was:", fullText);
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

let finalJsonText = jsonTextCandidate.slice(jsonStart, jsonEnd + 1);

// Remove comments from JSON (// ...)
finalJsonText = finalJsonText.replace(/\/\/.*$/gm, '');
// Remove trailing commas (simple case)
finalJsonText = finalJsonText.replace(/,\s*}/g, '}').replace(/,\s*]/g, ']');

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

  // Ensure summary exists
  if (!result.summary) {
      result.summary = "No summary provided by model.";
  }

  // Ensure severity exists
  if (!result.severity) {
      result.severity = "LOW";
  }

  // Ensure violations exists
  if (!result.violations) {
      result.violations = [];
  }

  // ✅ CASE 1: Fully valid schema
  const isValidFinalSchema =
    typeof result === "object" &&
    typeof result.verdict === "string" &&
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
