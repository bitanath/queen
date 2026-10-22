import { runFactor } from "./factors";
import { STOPWORDS, tokens } from "./text";

function terms(text: string): string[] {
  return tokens(text).filter((term) => term.length > 2 && !STOPWORDS.has(term));
}

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const x = a[index] ?? 0;
    const y = b[index] ?? 0;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  return na > 0 && nb > 0 ? dot / Math.sqrt(na * nb) : 0;
}

function tfidfMatrix(docs: string[][]): number[][] {
  const frequency = new Map<string, number>();
  for (const doc of docs) {
    for (const term of new Set(doc)) frequency.set(term, (frequency.get(term) ?? 0) + 1);
  }
  const vocabulary = [...frequency.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 200)
    .map(([term]) => term);
  const index = new Map(vocabulary.map((term, i) => [term, i]));
  const total = docs.length;
  return docs.map((doc) => {
    const counts = new Map<string, number>();
    for (const term of doc) {
      if (index.has(term)) counts.set(term, (counts.get(term) ?? 0) + 1);
    }
    return vocabulary.map((term) => {
      const tf = (counts.get(term) ?? 0) / Math.max(1, doc.length);
      const df = frequency.get(term) ?? 0;
      const idf = Math.log((total + 1) / (df + 1)) + 1;
      return tf * idf;
    });
  });
}

export function relevanceScores(query: string, documents: string[]): number[] {
  if (documents.length === 0) return [];
  const rows = [...documents, query].map(terms);
  const matrix = tfidfMatrix(rows);
  const queryRow = matrix.at(-1) ?? [];
  const docRows = matrix.slice(0, -1);

  const fallback = docRows.map((row) => Math.max(0, cosine(row, queryRow)));
  const vocabularySize = matrix[0]?.length ?? 0;
  if (documents.length < 2 || vocabularySize < 2) return fallback;

  const means = Array.from({ length: vocabularySize }, (_, column) => {
    return docRows.reduce((sum, row) => sum + (row[column] ?? 0), 0) / docRows.length;
  });
  const sds = Array.from({ length: vocabularySize }, (_, column) => {
    const mean = means[column] ?? 0;
    const variance =
      docRows.reduce((sum, row) => sum + ((row[column] ?? 0) - mean) ** 2, 0) / docRows.length;
    return Math.sqrt(variance) || 1;
  });
  const standardized = docRows.map((row) =>
    row.map((value, column) => ((value - (means[column] ?? 0)) / (sds[column] ?? 1))),
  );
  const queryStandardized = queryRow.map(
    (value, column) => ((value - (means[column] ?? 0)) / (sds[column] ?? 1)),
  );

  try {
    const model = runFactor(standardized, Math.min(5, vocabularySize, docRows.length));
    if (!model) return fallback;
    const queryScores = Array.from({ length: model.k }, (_, factor) =>
      queryStandardized.reduce(
        (sum, value, term) => sum + value * (model.loadings[term]?.[factor] ?? 0),
        0,
      ),
    );
    const scores = model.scores.map((score) => {
      const value = cosine(score, queryScores);
      return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
    });
    return scores.some((score) => score > 0) ? scores : fallback;
  } catch {
    return fallback;
  }
}
