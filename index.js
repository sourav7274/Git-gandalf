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
        { role: "system", content: "You are my friend" },
        { role: "user", content: "just testing a few things" }
      ]
    })
  }
);

const reader = response.body.getReader();
const decoder = new TextDecoder();

let buffer = "";

while (true) {
  const { value, done } = await reader.read();
  if (done) break;

  buffer += decoder.decode(value, { stream: true });

  const lines = buffer.split("\n");
  buffer = lines.pop(); // keep incomplete line

  for (const line of lines) {
    if (!line.startsWith("data:")) continue;

    const data = line.slice(5).trim(); // remove "data:"
    if (data === "[DONE]") {
      process.stdout.write("\n");
      break;
    }

    const json = JSON.parse(data);
    const token = json.choices?.[0]?.delta?.content;

    if (token) process.stdout.write(token);
  }
}
