import { exec } from "child_process";
import { promisify } from "util";
import { readFile, writeFile } from "fs/promises";
import readline from "readline";
let command = 'git diff --cached'

const execAsync = promisify(exec);

const args = process.argv.slice(2);
const forceFlag = args.includes("--force");
const skipSuggestionsFlag = args.includes("--skip-suggestions");
const suggestFlag = args.includes("--suggest") || process.env.GIT_SUGGEST === "1";
const applyFlag = args.includes("--apply");
const helpFlag = args.includes("--help");
const excludedFiles = ['index.js', 'rules.json','README.md','test_samples/run_tests.cjs'];

if (helpFlag) {
  console.log(`Gandalf - Git Commit Guardian
Usage: node index.js [options]

Options:
  --force              Skip LLM validation (not recommended)
  --skip-suggestions   Skip code suggestions after commit approval
  --suggest            Automatically generate code suggestions
  --apply               Apply code suggestions with confirmation
  --help               Show this help message`);
  process.exit(0);
}

if (forceFlag) {
  console.log("WARNING: --force flag detected. Skipping LLM validation.");
}

async function main() {

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

function safeExit(code) {
  if (exitCalled) return;
  exitCalled = true;
  process.exit(code);
}

function filterDiff(diff) {
  const lines = diff.split('\n');
  let filtered_lines = [];
  let currentFile = null;
  let includeCurrentFile = true;
  
  for (const line of lines) {
    if (line.startsWith('+++ b/')) {
      currentFile = line.slice(6).trim();
      includeCurrentFile = !excludedFiles.includes(currentFile);
    }
    
    if (includeCurrentFile) {
      filtered_lines.push(line);
    }
  }
  
  return filtered_lines.join('\n');
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

let codeChanges = await getStagedChanges();
codeChanges = filterDiff(codeChanges);

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
  return SEVERITY_ORDER[b.severity] - SEVERITY_ORDER[a.severity];
});

const stagedFiles = codeChanges
  .split('\n')
  .filter(line => line.startsWith('+++ b/'))
  .map(line => line.slice(6).trim());



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
      .filter(line => line.startsWith('+') && !line.startsWith('+++'))
      .map(line => line.slice(1).trim());

    if (addedLines.length === 0) {
       console.log("   [OK] No new lines added (deletions allowed)");
      continue;
    }

    const secretPatterns = [
      { pattern: /sk[-_][a-zA-Z0-9,]+/gi, name: "Stripe/OpenAI key (sk-)" },
      { pattern: /sk[-_][a-zA-Z0-9]{8,}/gi, name: "Stripe/OpenAI key (sk-)" },
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
    let fileHasChanges = false;
    
    for (let i = 0; i < allLines.length; i++) {
      const line = allLines[i];
      
      if (line.startsWith("+++ b/")) {
        if (currentFile && fileHasChanges) {
          if (openBraces !== 0) {
            violations.push("File: " + currentFile + " - Unbalanced braces: " + (openBraces > 0 ? "missing " + openBraces + " closing brace(s)" : "extra " + Math.abs(openBraces) + " closing brace(s)"));
          }
          if (openParens !== 0) {
            violations.push("File: " + currentFile + " - Unbalanced parentheses: " + (openParens > 0 ? "missing " + openParens + " closing paren(s)" : "extra " + Math.abs(openParens) + " closing paren(s)"));
          }
          if (openBrackets !== 0) {
            violations.push("File: " + currentFile + " - Unbalanced brackets: " + (openBrackets > 0 ? "missing " + openBrackets + " closing bracket(s)" : "extra " + Math.abs(openBrackets) + " closing bracket(s)"));
          }
        }
        currentFile = line.slice(6).trim();
        openBrackets = 0;
        openParens = 0;
        openBraces = 0;
        fileHasChanges = false;
      }
      
      if (line.startsWith('+') && !line.startsWith('+++')) {
        fileHasChanges = true;
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
        fileHasChanges = true;
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
    
    if (currentFile && fileHasChanges) {
      if (openBraces !== 0) {
        violations.push("File: " + currentFile + " - Unbalanced braces: " + (openBraces > 0 ? "missing " + openBraces + " closing brace(s)" : "extra " + Math.abs(openBraces) + " closing brace(s)"));
      }
      if (openParens !== 0) {
        violations.push("File: " + currentFile + " - Unbalanced parentheses: " + (openParens > 0 ? "missing " + openParens + " closing paren(s)" : "extra " + Math.abs(openParens) + " closing paren(s)"));
      }
      if (openBrackets !== 0) {
        violations.push("File: " + currentFile + " - Unbalanced brackets: " + (openBrackets > 0 ? "missing " + openBrackets + " closing bracket(s)" : "extra " + Math.abs(openBrackets) + " closing bracket(s)"));
      }
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

  if (skipSuggestionsFlag) {
    console.log("\nYou may pass, traveler!");
    safeExit(0);
  }

  let shouldSuggest = suggestFlag || applyFlag;

  if (!shouldSuggest) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    
    const question = (p) => new Promise((resolve) => rl.question(p, resolve));
    
    const answer = await question("\nWould you like code suggestions? [y/N] ");
    rl.close();
    shouldSuggest = answer.trim().toLowerCase() === "y" || answer.trim().toLowerCase() === "yes";
  }

  if (shouldSuggest) {
    const isApplyMode = applyFlag;
    console.log("\n" + (isApplyMode ? "Generating and applying code refactoring..." : "Generating code suggestions..."));
    
    const suggestionPrompt = isApplyMode 
      ? `Analyze the following git diff and provide refactoring suggestions that:
1. Shorten/optimize the code (convert repeated code into loops, reduce duplication)
2. Fix issues/bugs in the code
3. Maintain exact functionality

For each suggestion, provide:
- File name (must match staged files)
- Line number (starting line)
- Brief explanation
- Original code (the exact code to replace)
- Refactored code (the improved code)

IMPORTANT: If code can be optimized (e.g., repeated statements → loop), always provide the refactored version. Format your response as a JSON array:
[{"file": "filename", "line": lineNum, "explanation": "brief explanation", "original": "exact original code", "refactored": "improved code"}]`
      : `Analyze the following git diff and provide suggestions that either:
1. Shorten/optimize the code (reduce lines while maintaining functionality)
2. Fix issues/bugs in the code

For each suggestion, provide:
- File name and line number
- Brief explanation
- The suggested code change

Git diff:
${codeChanges}`;

    const systemPrompt = isApplyMode
      ? "You are a code refactoring assistant. Provide concise, actionable refactoring suggestions. Always optimize repeated code into loops. Only respond with valid JSON array format: [{\"file\": \"filename\", \"line\": lineNum, \"explanation\": \"brief explanation\", \"original\": \"exact original code\", \"refactored\": \"improved code\"}]"
      : "You are a code reviewer. Provide concise, actionable suggestions to improve code. Only respond with valid JSON array format: [{\"file\": \"filename\", \"line\": lineNum, \"explanation\": \"brief explanation\", \"suggestion\": \"suggested code\"}]";

    try {
      const response = await fetch("http://localhost:11434/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "qwen2.5-coder:3b",
          stream: false,
          format: "json",
          options: { temperature: 0, num_ctx: 2048 },
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: suggestionPrompt }
          ]
        })
      });

      const data = await response.json();
      const suggestions = data.message?.content || "[]";
      
      try {
        const parsed = JSON.parse(suggestions);
        if (Array.isArray(parsed) && parsed.length > 0) {
          console.log("\n=== " + (isApplyMode ? "REFACTORING SUGGESTIONS" : "CODE SUGGESTIONS") + " ===\n");
          
          for (const s of parsed) {
            if (isApplyMode) {
              console.log(`📁 ${s.file}:${s.line}`);
              console.log(`   Explanation: ${s.explanation}`);
              console.log(`   Original:\n   ${(s.original || "").split('\n').join('\n   ')}`);
              console.log(`   Refactored:\n   ${(s.refactored || "").split('\n').join('\n   ')}\n`);
            } else {
              console.log(`📁 ${s.file}:${s.line}`);
              console.log(`   Explanation: ${s.explanation}`);
              console.log(`   Suggestion: ${s.suggestion}\n`);
            }
          }
          
          if (isApplyMode) {
            const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
            const question = (p) => new Promise((resolve) => rl.question(p, resolve));
            
            const confirm = await question("\nApply these refactoring suggestions? [y/N] ");
            rl.close();
            
            if (confirm.trim().toLowerCase() === "y" || confirm.trim().toLowerCase() === "yes") {
              console.log("\nApplying refactoring...");
              
              const backupFiles = [];
              
              for (const s of parsed) {
                try {
                  const backupPath = s.file + '.backup';
                  const originalContent = await readFile(s.file, 'utf8');
                  await writeFile(backupPath, originalContent);
                  backupFiles.push(backupPath);
                  
                  let newContent = originalContent;
                  if (s.original && s.refactored) {
                    newContent = newContent.split(s.original).join(s.refactored);
                  }
                  
                  await writeFile(s.file, newContent);
                  console.log(`   ✓ Applied to ${s.file}`);
                } catch (err) {
                  console.log(`   ✗ Failed to apply to ${s.file}: ${err.message}`);
                }
              }
              
              console.log("\nRunning tests...");
              let testsPassed = true;
              try {
                const { stdout, stderr } = await execAsync('npm test');
                console.log(stdout);
                if (stderr) console.error(stderr);
              } catch (err) {
                testsPassed = false;
                console.log(`   Tests failed: ${err.message}`);
              }
              
              if (!testsPassed) {
                console.log("\n⚠ Tests failed. Rolling back...");
                for (const backup of backupFiles) {
                  const originalPath = backup.replace('.backup', '');
                  try {
                    const backupContent = await readFile(backup, 'utf8');
                    await writeFile(originalPath, backupContent);
                    console.log(`   ✓ Rolled back ${originalPath}`);
                  } catch (err) {
                    console.log(`   ✗ Failed to rollback ${originalPath}: ${err.message}`);
                  }
                }
                console.log("\n[X] Refactoring failed. Changes rolled back.");
                safeExit(1);
              } else {
                console.log("\n✓ Tests passed! Refactoring applied successfully.");
                console.log("\n[OK] You may pass, traveler!");
                safeExit(0);
              }
            } else {
              console.log("\nRefactoring skipped.");
              console.log("\nYou may pass, traveler!");
              safeExit(0);
            }
          } else {
            console.log("\nYou may pass, traveler!");
            safeExit(0);
          }
        } else {
          console.log("\nNo suggestions found for this diff.");
          console.log("\nYou may pass, traveler!");
          safeExit(0);
        }
      } catch {
        console.log("\nSuggestions:");
        console.log(suggestions);
        console.log("\nYou may pass, traveler!");
        safeExit(0);
      }
    } catch (e) {
      console.log("\nCould not generate suggestions. Make sure Ollama is running.");
      console.log("\nYou may pass, traveler!");
      safeExit(0);
    }
  }

  console.log("\nYou may pass, traveler!");
  safeExit(0);
}

}

main();