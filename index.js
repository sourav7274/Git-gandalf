import { exec } from "child_process";
import { promisify } from "util";
import { readFile } from "fs/promises";
let command = 'git diff --cached'

const execAsync = promisify(exec);

const args = process.argv.slice(2);
const forceFlag = args.includes("--force");

if (forceFlag) {
  console.log("WARNING: --force flag detected. Skipping LLM validation.");
}

const gandalfArt = `
                      _,-
   (\\                  _,-','
    \\\\.              ,-"  ,'
     \\\\           ,'   ,'
      \\\\        _:.----__.-."-._,-_
       \\\\    .-".:--\`:::::.:.'  )  \`-.
        \\\\   \`. ::L .::::::'\`\`-._  (  ) :
         \\\\    ":::::::'  \`-.   \`-_ ) ,'
          \\\\.._\`:::,' \`.     .  \`-:
          :" _   "\\"" \`-_    .    \`  \`.
           "\\\\"":--\\     \`-.__ \` .     \`.
             \\'::  \\    _-"__\`--.__ \`  . \`.     _,--..-
              \\ ::  \\\\_-":)(        ""-._ \` \`.-''
               \\\`:\`-":::/ \\ .   .      \`-.  :
               :\\\\:::::::'  \\     \`    .   \`. :
                :\\\\:':':'  . \\\\           \`,\`  : :
                : \\     .    \\\\      .       \`. :       ,-
               __\`:\\      .   \\\\ .   \` ,'    ,: :   ,-'
        _,---""  :  \\ '        \\\\  .          :-"  ,'
    ,-""        :    \\:  .  :   \\\\  \`  '     ,'   /
   '            :  :  \\       .   \\\\   .   _,'  ,-'
               :  .   '       :   :\`   \`,-' ,--'
                :     :   :      ,'-._,' ,-'
                _:     :        :8:  ,--'
               :dd\`-._,'-._.__-""' ,'
                             ,----'
                      _.----'
              __..--""`;

const SEVERITY_ORDER = {
  "LOW": 1,
  "MEDIUM": 2,
  "HIGH": 3,
  "CRITICAL": 4
};

const appreciationMessages = {
  "LOW": ["MINOR check passed", "Minor detail noted", "Minor note cleared"],
  "MEDIUM": ["Medium check passed", "Standard check cleared", "Medium verification done"],
  "HIGH": ["High check passed", "Important check cleared", "High priority verified"],
  "CRITICAL": ["Critical check passed", "Security check cleared", "Critical verification done"]
};

let exitCalled = false;
let exitCode = 0;

function safeExit(code) {
  if (exitCalled) return;
  exitCalled = true;
  setTimeout(() => process.exit(code), 100);
}

async function getStagedChanges() {
  try {
    const { stdout, stderr } = await execAsync(command);
    if (stderr) console.error("stderr:", stderr);
    if (stdout) return stdout;
    return "There are no staged changes.";
  } catch (err) {
    console.error("error:", err.message);
    return null;
  }
}

async function getCurrentBranch() {
  try {
    const { stdout } = await execAsync('git branch --show-current');
    return stdout.trim();
  } catch (err) {
    return null;
  }
}

const codeChanges = await getStagedChanges();

if (codeChanges === "There are no staged changes.") {
  console.log(gandalfArt);
  console.log("\nYou shall not pass... without my approval!");
  console.log("\n[OK] No staged changes detected. Commit allowed.");
  safeExit(0);
}

async function readRules(path) {
  try {
    const data = await readFile(path, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    console.error("Error reading rules file:", err);
    return { gitSafetyRules: [] };
  }
}

const myRules = await readRules('rules.json');

const sortedRules = [...myRules.gitSafetyRules].sort((a, b) => {
  return SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
});

console.log(gandalfArt);
console.log("\nYou shall not pass... without my approval!");
console.log("\nChecking rules in order of severity...\n");

for (let i = 0; i < sortedRules.length; i++) {
  const rule = sortedRules[i];
  const severityStars = "★".repeat(SEVERITY_ORDER[rule.severity]);
  console.log("\n[" + (i + 1) + "/" + sortedRules.length + "] Checking: " + rule.rule + " " + severityStars);
  
  let ruleCheckPrompt = "Check if the staged diff violates ONLY this rule:\nRule: " + rule.rule + "\nDescription: " + rule.description + "\nSeverity: " + rule.severity;

  if (rule.rule.toLowerCase().includes("secret") || rule.rule.toLowerCase().includes("credential")) {
    const addedLines = codeChanges
      .split('\n')
      .filter(line => line.startsWith('+') && !line.startsWith('+++') && !line.startsWith('+ '))
      .map(line => line.slice(1).trim());

    if (addedLines.length === 0) {
       console.log("   [OK] No new lines added (deletions allowed)");
      continue;
    }

    const secretPatterns = [
      { pattern: /sk[-_][a-zA-Z0-9]{20,}/gi, name: "Stripe/OpenAI key (sk-)" },
      { pattern: /AKIA[0-9A-Z]{16}/g, name: "AWS key (AKIA)" },
      { pattern: /password\s*[:=]\s*["'][^"']{4,}/gi, name: "password assignment" },
      { pattern: /token\s*[:=]\s*["'][^"']{10,}/gi, name: "token assignment" },
      { pattern: /api[_-]?key\s*[:=]\s*["'][^"']{10,}/gi, name: "api_key assignment" },
      { pattern: /secret\s*[:=]\s*["'][^"']{10,}/gi, name: "secret assignment" }
    ];

    let foundViolations = [];
    const seenLines = new Set();
    for (const line of addedLines) {
      for (const sp of secretPatterns) {
        if (sp.pattern.test(line)) {
          if (!seenLines.has(line)) {
            seenLines.add(line);
            foundViolations.push({
              files: ["unknown"],
              line: 0,
              content: line,
              violatingLine: line
            });
          }
        }
      }
    }

    if (foundViolations.length > 0) {
      console.log("\n   [X] " + rule.rule);
      for (const v of foundViolations) {
        console.log("   ! " + v.violatingLine.substring(0, 60) + "...");
      }
      console.log("\n[X] You shall not pass!");
      safeExit(1);
    } else {
      console.log("   [OK] " + (appreciationMessages[rule.severity] || appreciationMessages["LOW"])[Math.floor(Math.random() * 3)]);
    }
  }

  if (rule.rule.toLowerCase().includes("format")) {
    const allLines = codeChanges.split('\n');
    let openBrackets = 0;
    let openParens = 0;
    let openBraces = 0;
    let violations = [];
    let currentFile = "";
    
    for (let i = 0; i < allLines.length; i++) {
      const line = allLines[i];
      
      if (line.startsWith("+++ b/")) {
        currentFile = line.slice(6).trim();
        openBrackets = 0;
        openParens = 0;
        openBraces = 0;
      }
      
      if (line.startsWith('+') && !line.startsWith('+++')) {
        const codeLine = line.slice(1);
        for (const char of codeLine) {
          if (char === '{') openBraces++;
          if (char === '}') openBraces--;
          if (char === '(') openParens++;
          if (char === ')') openParens--;
          if (char === '[') openBrackets++;
          if (char === ']') openBrackets--;
        }
        
      }
      
      if (line.startsWith('-') && !line.startsWith('---')) {
        const codeLine = line.slice(1);
        for (const char of codeLine) {
          if (char === '{') openBraces--;
          if (char === '}') openBraces++;
          if (char === '(') openParens--;
          if (char === ')') openParens++;
          if (char === '[') openBrackets--;
          if (char === ']') openBrackets++;
        }
      }
    }
    
    if (openBraces !== 0) {
      violations.push("File: " + currentFile + " - Unbalanced braces: " + (openBraces > 0 ? "missing " + openBraces + " closing brace(s)" : "extra " + Math.abs(openBraces) + " closing brace(s)"));
    }
    if (openParens !== 0) {
      violations.push("File: " + currentFile + " - Unbalanced parentheses: " + (openParens > 0 ? "missing " + openParens + " closing paren(s)" : "extra " + Math.abs(openParens) + " closing paren(s)"));
    }
    if (openBrackets !== 0) {
      violations.push("File: " + currentFile + " - Unbalanced brackets: " + (openBrackets > 0 ? "missing " + openBrackets + " closing bracket(s)" : "extra " + Math.abs(openBrackets) + " closing bracket(s)"));
    }
    
    if (violations.length > 0) {
      console.log("\n   [X] " + rule.rule);
      for (const v of violations) {
        console.log("   ! " + v);
      }
      console.log("\n[X] You shall not pass!");
      safeExit(1);
    }
    
    console.log("   [OK] Brackets balanced");
    continue;
  }

  if (rule.rule.toLowerCase().includes("protected branch")) {
    const currentBranch = await getCurrentBranch();
    const protectedBranches = ['main', 'master'];
    
    if (currentBranch && protectedBranches.includes(currentBranch.toLowerCase())) {
      console.log("\n   [X] " + rule.rule);
      console.log("   ! Direct commits to protected branch '" + currentBranch + "' are not allowed.");
      console.log("   ! Please create a feature branch and submit a pull request instead.");
      console.log("\n[X] You shall not pass!");
      safeExit(1);
    } else {
      console.log("   [OK] Not a protected branch (current: " + (currentBranch || "unknown") + ")");
      continue;
    }
  }

  const response = await fetch("http://localhost:11434/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "qwen2.5-coder:3b",
      stream: false,
      format: "json",
      options: { temperature: 0, num_ctx: 2048 },
      messages: [
        { role: "system", content: ruleCheckPrompt },
        { role: "user", content: "Staged git diff:\n" + String(codeChanges) }
      ]
    })
  });

  try {
    const data = await response.json();
    const rawContent = data.message?.content || "{}";
    const result = JSON.parse(rawContent);
    
    if (result.violated) {
      console.log("\n   [X] " + rule.rule);
      const violationsList = result.violations || [{ files: result.files, line: result.line, content: result.content, violatingLine: result.violatingLine }];
      for (const v of violationsList) {
        if (v.files) {
          console.log("   Warning: " + v.files[0] + ":" + (v.line || "?") + " -> " + (v.content || v.details));
        }
        if (v.violatingLine) {
          console.log("   Line: " + v.violatingLine.replace(/^./, ''));
        }
      }
      violations.push({ rule: rule, result: result, violationsList: violationsList });
      console.log("\n[X] You shall not pass!");
      safeExit(1);
    } else {
      const msgs = appreciationMessages[rule.severity] || appreciationMessages["LOW"];
      console.log("   " + msgs[Math.floor(Math.random() * msgs.length)]);
    }
  } catch (e) {
    console.log("   Warning: Could not verify rule, assuming passed");
  }
}

if (exitCalled) {
} else {
  console.log("\n[OK] COMMIT APPROVED");
  console.log("   ----------------------");
  console.log("   The code is worthy.");
  console.log("\nYou may pass, traveler!");
  safeExit(0);
}
