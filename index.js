import { exec } from "child_process";
import { promisify } from "util";
import { readFile } from "fs/promises";
let command = 'git diff --cached --unified=0'

const execAsync = promisify(exec);

let api_key = "dfsdsdfsdfsdf6s987d6f7s6df6s9866s9fguyuyuy"

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
          content: `You are an expert git protector, 
          which allows the commit to go through or stop it after 
          reviewing the code changes of the project. If there are no changes, 
          return PASS immediately, no need to check the rules, just follow the output strcuture json. 
          Here are the project rules:\n${rulesText},
          Use <think>...</think> for reasoning.Use <final>...</final> 
          for the final answer.Only valid JSON is allowed inside <final>. 
          , please follwo the rules for output strictly` },
        { role: "user", 
          content: `I am passing my code changes from my project, 
          there may / maybe not be changes,please let me know, 
          if this is safe to commit, and also summarize the changes,  
          ${codeChanges}` }
      ]
    })
  }
);


// STREAMING LOGIC
const reader = response.body.getReader();
const decoder = new TextDecoder();

let buffer = "";

// --- FINAL DETECTION STATE ---
let inFinal = false;
let finalDone = false;
let finalBuffer = "";

const FINAL_OPEN = "<final>";
const FINAL_CLOSE = "</final>";

while (true) {
  const { value, done } = await reader.read();
  if (done) break;

  buffer += decoder.decode(value, { stream: true });

  const lines = buffer.split("\n");
  buffer = lines.pop(); // keep incomplete line

  for (const line of lines) {
    if (!line.startsWith("data:")) continue;

    const data = line.slice(5).trim();
    if (data === "[DONE]") break;

    let json;
    try {
      json = JSON.parse(data);
    } catch {
      continue; // skip non-JSON chunks
    }

    const token = json.choices?.[0]?.delta?.content;
    if (!token) continue;

    // 1️⃣ Show text as it streams
    process.stdout.write(token);

    // 2️⃣ Detect <final> start
    if (!inFinal && token.includes(FINAL_OPEN)) {
      inFinal = true;
      finalBuffer = token.slice(token.indexOf(FINAL_OPEN));
      continue;
    }

    // 3️⃣ Collect tokens inside <final>
    if (inFinal) {
      finalBuffer += token;

      // Detect </final> end
      if (finalBuffer.includes(FINAL_CLOSE)) {
        finalDone = true;
        break;
      }
    }
  }

  if (finalDone) break;
}

// --- SAFETY CHECK ---
if (!finalDone) {
  console.error("\n❌ No <final> block found. Blocking commit.");
  process.exit(1);
}

// --- CLEAN FINAL JSON ---
const cleaned = finalBuffer
  .replace(/<final>/g, "")
  .replace(/<\/final>/g, "")
  .trim();

// --- PARSE JSON ---
let result;
try {
  result = JSON.parse(cleaned);

  // Validate required fields
  if (!result.verdict || !result.summary || !Array.isArray(result.violations)) {
    throw new Error("Missing required fields in <final> JSON");
  }
} catch (err) {
  console.error("\n❌ Invalid JSON inside <final> or missing fields:");
  console.error(cleaned);
  process.exit(1);
}

// --- ACT BASED ON VERDICT ---
if (result.verdict === "BLOCK") {
  console.error("\n🚫 Commit BLOCKED:", result.summary);
  process.exit(1);
}

if (result.verdict === "PASS") {
  console.log("\n✅ Commit ALLOWED:", result.summary);
  process.exit(0);
}

// Catch-all safety (should never reach here)
console.error("\n❌ Unexpected verdict. Blocking commit by default.");
process.exit(1);


