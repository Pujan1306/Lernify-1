import { ENV } from "./env.js";
import OpenAI from "openai";

if (!ENV.OPENROUTER_API_KEY) {
  console.error("FATAL ERROR: OPENROUTER_API_KEY is missing");
  process.exit(1);
}


const openai = new OpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: ENV.OPENROUTER_API_KEY,
  defaultHeaders: {
    "HTTP-Referer": ENV.BACKEND_URL,
    "X-Title": "Lernify AI",
  }
});

const FREE_MODELS = [
  "openai/gpt-oss-120b:free",
  "google/gemini-2.0-flash-lite-preview-02-05:free",
  "meta-llama/llama-3.3-70b-instruct:free"
];


async function callOpenRouter(prompt) {
  let lastError;

  for (const modelName of FREE_MODELS) {
    try {
      console.log(`[AI] Attempting OpenRouter stream with model: "${modelName}"`);

      const stream = await openai.chat.completions.create({
        model: modelName,
        messages: [{ role: "user", content: prompt }],
        stream: true,
      });

      let fullResponse = "";

      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content;
        if (content) {
          fullResponse += content;
        }
      }

      if (fullResponse) {
        console.log(`[AI] Successfully generated response using: ${modelName}`);
        return fullResponse;
      }

    } catch (error) {
      lastError = error;
      const status = error.status || 500;

      if ([429, 404, 528, 503].includes(status)) {
        console.warn(`[AI] Model ${modelName} unavailable (Code: ${status}). Trying next...`);
        continue;
      }

      console.error(`[AI] API Error on ${modelName}:`, error.message);
      throw error;
    }
  }

  console.error("[AI] Fatal Error: All free models failed or are rate-limited.");
  throw new Error(`Failed to generate response: ${lastError?.message}`);
}

export async function generateFlashcards(text, count = 10) {
  const prompt = `
Generate exactly ${count} educational flashcards from the text below.
Do not include any conversational filler like "Here are your flashcards".

Format each flashcard EXACTLY like this:
Q: Question
A: Answer
D: easy | medium | hard

Separate flashcards with ___

Text: ${text.slice(0, 15000)}
`;

  const output = await callOpenRouter(prompt);

  if (!output) throw new Error("Empty OpenRouter response");

  const cards = output.split("___").map((c) => c.trim()).filter(Boolean);
  const flashcards = [];

  for (const card of cards) {
    const lines = card.split("\n").map((l) => l.trim());
    let question = "";
    let answer = "";
    let difficulty = "medium";

    for (const line of lines) {
      if (line.startsWith("Q:")) question = line.slice(2).trim();
      if (line.startsWith("A:")) answer = line.slice(2).trim();
      if (line.startsWith("D:")) {
        const d = line.slice(2).trim().toLowerCase();
        if (["easy", "medium", "hard"].includes(d)) difficulty = d;
      }
    }

    if (question && answer) {
      flashcards.push({ question, answer, difficulty });
    }
  }

  return flashcards.slice(0, count);
}

export async function generateQuiz(text, numQuestions = 5) {
  const prompt = `
Generate exactly ${numQuestions} multiple-choice questions.
Do not include any conversational filler.

Format EXACTLY:
Q: Question
01: Option
02: Option
03: Option
04: Option
C: Correct option number (01–04)
E: Explanation
D: easy | medium | hard

Separate questions with ___

Text: ${text.slice(0, 15000)}
`;

  const output = await callOpenRouter(prompt);

  if (!output) throw new Error("Empty OpenRouter response");

  const blocks = output.split("___").map((b) => b.trim()).filter(Boolean);
  const questions = [];

  for (const block of blocks) {
    const lines = block.split("\n").map((l) => l.trim());

    let question = "";
    let options = [];
    let correctAnswer = "";
    let explanation = "";
    let difficulty = "medium";

    for (const line of lines) {
      if (line.startsWith("Q:")) question = line.slice(2).trim();
      else if (/^\d{2}:/.test(line)) options.push(line.slice(3).trim());
      else if (line.startsWith("C:")) correctAnswer = line.slice(2).trim();
      else if (line.startsWith("E:")) explanation = line.slice(2).trim();
      else if (line.startsWith("D:")) {
        const d = line.slice(2).trim().toLowerCase();
        if (["easy", "medium", "hard"].includes(d)) difficulty = d;
      }
    }

    if (question && options.length === 4 && correctAnswer) {
      questions.push({
        question,
        options,
        correctAnswer,
        explanation,
        difficulty,
      });
    }
  }

  return questions.slice(0, numQuestions);
}


export async function generateSummary(text) {
  const prompt = `
Summarize the following text clearly and concisely. Use bullet points if helpful.

Text: ${text.slice(0, 20000)}
`;

  const output = await callOpenRouter(prompt, 0.5);

  if (!output) throw new Error("Empty OpenRouter response");

  return output.trim();
}

export const explainConcept = async (concept, context) => {
  const prompt = `Explain the concept of "${concept}" based on the following context. Provide a clear, educational explanation that's easy to understand. Include examples if relevant.

Context: ${context.substring(0, 10000)}`;

  try {
    return await callOpenRouter(prompt, 0.5);
  } catch (error) {
    throw new Error("Failed to explain concept");
  }
};

export const chatWithContext = async (question, chunks) => {
  const context = chunks
    .map((c, i) => `[Chunk ${i + 1}]\n${c.content}`)
    .join("\n\n");

  console.log("context_____", context);

  const prompt = `Based on the following context from a document, analyse the context and answer the user's question. If the answer is not in the context, say so.

Context: ${context}

Question: ${question}

Answer:`;

  try {
    return await callOpenRouter(prompt, 0.5);
  } catch (error) {
    throw new Error("Failed to generate chat response");
  }
};
