const assert = require('assert');

function checkBrackets(codeChanges) {
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
    
    if (line.startsWith('+') && !line.startsWith('+++') && !line.startsWith('+ ')) {
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
  
  return violations;
}

function checkSecrets(codeChanges) {
  const addedLines = codeChanges
    .split('\n')
    .filter(line => line.startsWith('+') && !line.startsWith('+++') && !line.startsWith('+ '))
    .map(line => line.slice(1).trim());

  if (addedLines.length === 0) return [];

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
          foundViolations.push({ name: sp.name, line: line });
        }
      }
    }
  }
  return foundViolations;
}

console.log("Running validation tests...\n");

let passed = 0;
let failed = 0;

console.log("=== BRACKET TESTS ===\n");

const balancedDiff = `diff --git a/test.js b/test.js
--- a/test.js
+++ b/test.js
@@ -1,3 +1,3 @@
 function test() {
-  const x = 1;
+  const arr = [1, 2, 3];
+  if (arr.length > 0) {
+    console.log("has items");
+  }
+  return arr.join("");
 }`;

let result = checkBrackets(balancedDiff);
if (result.length === 0) {
  console.log("✓ PASS: Balanced brackets in added lines detected");
  passed++;
} else {
  console.log("✗ FAIL: Balanced brackets test - got:", result);
  failed++;
}

const unbalancedBracesDiff = `diff --git a/test.js b/test.js
--- a/test.js
+++ b/test.js
@@ -1,3 +1,5 @@
-function test() {
-return 1;
+function test() {
+if (true) {
+console.log("test");
+return 1;`;

result = checkBrackets(unbalancedBracesDiff);
if (result.length > 0 && result[0].includes("Unbalanced braces")) {
  console.log("✓ PASS: Unbalanced braces detected");
  passed++;
} else {
  console.log("✗ FAIL: Unbalanced braces test - got:", result);
  failed++;
}

const unbalancedParensDiff = `diff --git a/test.js b/test.js
--- a/test.js
+++ b/test.js
@@ -1,3 +1,3 @@
-const x = 1;
+const result = (1 + 2;
+return result;`;

result = checkBrackets(unbalancedParensDiff);
if (result.length > 0 && result[0].includes("Unbalanced parentheses")) {
  console.log("✓ PASS: Unbalanced parentheses detected");
  passed++;
} else {
  console.log("✗ FAIL: Unbalanced parentheses test - got:", result);
  failed++;
}

const extraBracketsDiff = `diff --git a/test.js b/test.js
--- a/test.js
+++ b/test.js
@@ -1,3 +1,3 @@
-const x = 1;
+const arr = [1, 2, 3]];
+return arr;`;

result = checkBrackets(extraBracketsDiff);
if (result.length > 0 && result[0].includes("extra")) {
  console.log("✓ PASS: Extra closing brackets detected");
  passed++;
} else {
  console.log("✗ FAIL: Extra brackets test - got:", result);
  failed++;
}

console.log("\n=== SECRET DETECTION TESTS ===\n");

const apiKeyDiff = `diff --git a/test.js b/test.js
--- a/test.js
+++ b/test.js
@@ -1,3 +1,3 @@
-const x = 1;
+const apiKey = "sk_test_12345678901234567890";
+return apiKey;`;

result = checkSecrets(apiKeyDiff);
if (result.length > 0 && (result[0].name.includes("OpenAI") || result[0].name.includes("api_key"))) {
  console.log("✓ PASS: API key detected");
  passed++;
} else {
  console.log("✗ FAIL: API key test - got:", result);
  failed++;
}

const passwordDiff = `diff --git a/test.js b/test.js
--- a/test.js
+++ b/test.js
@@ -1,3 +1,3 @@
-const x = 1;
+const password = "secret123";
+return password;`;

result = checkSecrets(passwordDiff);
if (result.length > 0 && result[0].name.includes("password")) {
  console.log("✓ PASS: Password detected");
  passed++;
} else {
  console.log("✗ FAIL: Password test - got:", result);
  failed++;
}

const tokenDiff = `diff --git a/test.js b/test.js
--- a/test.js
+++ b/test.js
@@ -1,3 +1,3 @@
-const x = 1;
+const token = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9";
+return token;`;

result = checkSecrets(tokenDiff);
if (result.length > 0 && result[0].name.includes("token")) {
  console.log("✓ PASS: Token detected");
  passed++;
} else {
  console.log("✗ FAIL: Token test - got:", result);
  failed++;
}

const noSecretsDiff = `diff --git a/test.js b/test.js
--- a/test.js
+++ b/test.js
@@ -1,3 +1,3 @@
-const x = 1;
+const greeting = "hello world";
+return greeting;`;

result = checkSecrets(noSecretsDiff);
if (result.length === 0) {
  console.log("✓ PASS: No false positives for safe code");
  passed++;
} else {
  console.log("✗ FAIL: Safe code test - got:", result);
  failed++;
}

console.log("\n=== EXCLUDED FILES TESTS ===\n");

const excludedFiles = ['index.js', 'rules.json'];

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

const indexJsDiff = `diff --git a/index.js b/index.js
--- a/index.js
+++ b/index.js
@@ -1,3 +1,3 @@
-const x = 1;
+const password = "secret123";
+return password;`;

let filteredResult1 = filterDiff(indexJsDiff);
if (filteredResult1.includes("password")) {
  console.log("✗ FAIL: index.js should have been excluded but was checked");
  failed++;
} else if (!filteredResult1.includes("+++ b/index.js")) {
  console.log("✓ PASS: index.js excluded from validation");
  passed++;
} else {
  console.log("✗ FAIL: index.js exclusion test - got unexpected result");
  failed++;
}

const rulesJsonDiff = `diff --git a/rules.json b/rules.json
--- a/rules.json
+++ b/rules.json
@@ -1,3 +1,3 @@
-const x = 1;
+const apiKey = "sk_test_12345678901234567890";
+return apiKey;`;

let filteredResult2 = filterDiff(rulesJsonDiff);
if (filteredResult2.includes("apiKey")) {
  console.log("✗ FAIL: rules.json should have been excluded but was checked");
  failed++;
} else if (!filteredResult2.includes("+++ b/rules.json")) {
  console.log("✓ PASS: rules.json excluded from validation");
  passed++;
} else {
  console.log("✗ FAIL: rules.json exclusion test - got unexpected result");
  failed++;
}

const normalFileDiff = `diff --git a/myapp.js b/myapp.js
--- a/myapp.js
+++ b/myapp.js
@@ -1,3 +1,3 @@
-const x = 1;
+const password = "secret123";
+return password;`;

let filteredResult3 = filterDiff(normalFileDiff);
if (filteredResult3.includes("password") && filteredResult3.includes("+++ b/myapp.js")) {
  console.log("✓ PASS: Non-excluded files are still validated");
  passed++;
} else {
  console.log("✗ FAIL: Non-excluded files test - got unexpected result");
  failed++;
}

const mixedDiff = `diff --git a/index.js b/index.js
--- a/index.js
+++ b/index.js
@@ -1,3 +1,3 @@
-const x = 1;
+const password = "secret123";
+diff --git a/myapp.js b/myapp.js
--- a/myapp.js
+++ b/myapp.js
@@ -1,3 +1,3 @@
-const x = 1;
+const password = "secret123";`;

let filteredResult4 = filterDiff(mixedDiff);
const hasIndexJs = filteredResult4.includes("+++ b/index.js");
const hasMyApp = filteredResult4.includes("+++ b/myapp.js");
const hasPassword = filteredResult4.includes("password");
if (!hasIndexJs && hasMyApp && hasPassword) {
  console.log("✓ PASS: Mixed diff - excluded filtered, normal file kept");
  passed++;
} else {
  console.log("✗ FAIL: Mixed diff test - got unexpected result, hasIndexJs:", hasIndexJs, "hasMyApp:", hasMyApp);
  failed++;
}

console.log("\n=== MULTI-FILE TESTS ===\n");

const multiFileDiff = `diff --git a/file1.js b/file1.js
--- a/file1.js
+++ b/file1.js
@@ -1,3 +1,3 @@
-function test() {
-  return 1;
+function test() {
+  return 1;
+}
+diff --git a/file2.js b/file2.js
--- a/file2.js
+++ b/file2.js
@@ -1,3 +1,3 @@
-function demo() {
-  return 2;
+function demo() {
+  const x = (1 + 2;
+  return x;`;

let bracketResult = checkBrackets(multiFileDiff);
if (bracketResult.length > 0 && bracketResult[0].includes("file2.js")) {
  console.log("✓ PASS: Multi-file - only second file flagged");
  passed++;
} else {
  console.log("✗ FAIL: Multi-file test - got:", bracketResult);
  failed++;
}

console.log("\n=== SUMMARY ===");
console.log(`Passed: ${passed}/${passed + failed}`);
console.log(`Failed: ${failed}/${passed + failed}`);

if (failed > 0) {
  process.exit(1);
} else {
  console.log("\n✓ All tests passed!");
  process.exit(0);
}