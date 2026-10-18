//MARK: - Topic wise generic lexicons. Topic sets use common English words only.

export const FILLER = new Set(["uh", "um", "hmm", "ah", "oh", "ha", "hehe", "er", "mm", "huh", "eh"]);
export const I_W = new Set(["i", "me", "my", "mine", "myself", "im"]);
export const YOU_W = new Set(["you", "your", "yours", "youre"]);
export const WE_W = new Set(["we", "us", "our", "ours", "lets"]);
export const FUT_W = new Set([
  "will", "going", "tomorrow", "next", "later", "plan", "plans", "planned", "planning",
  "tonight", "soon", "upcoming", "weekend",
]);

import type { TopicKey } from "./types";

export const TOPIC_LEXICONS: Record<TopicKey, Set<string>> = {
  travel: new Set([
    "travel", "trip", "flight", "flights", "fly", "hotel", "airport", "journey", "itinerary",
    "luggage", "suitcase", "passport", "vacation", "holiday", "tour", "booking", "booked",
    "destination", "ticket", "train", "bus", "taxi", "drive", "road", "map", "abroad", "overseas",
    "visa", "resort", "beach", "mountain", "city", "visit", "sightseeing", "stay", "pack",
  ]),
  work: new Set([
    "work", "job", "office", "meeting", "meetings", "project", "deadline", "presentation", "report",
    "boss", "colleague", "client", "task", "tasks", "email", "schedule", "shift", "team", "manager",
    "contract", "hire", "interview", "career", "business", "company", "budget", "invoice", "review",
    "submit", "deliverable", "stakeholder", "launch", "sprint",
  ]),
  social: new Set([
    "friend", "friends", "family", "call", "party", "invite", "visit", "group", "everyone", "guys",
    "sir", "madam", "wedding", "birthday", "celebrate", "catch", "chat", "talk", "hang", "together",
    "cousin", "brother", "sister", "mother", "father", "parents", "neighbour", "neighbor", "guest",
    "host", "greet", "hello", "hi",
  ]),
  food: new Set([
    "food", "eat", "eating", "meal", "breakfast", "lunch", "dinner", "coffee", "tea", "snack",
    "snacks", "grocery", "groceries", "recipe", "cook", "cooking", "kitchen", "restaurant", "menu",
    "order", "water", "drink", "hungry", "delicious", "taste", "sweet", "spicy", "vegetarian",
    "burger", "pizza", "bread", "rice", "egg", "eggs", "noodles",
  ]),
  health: new Set([
    "sleep", "sleeping", "tired", "doctor", "gym", "medicine", "health", "pain", "relax", "relaxing",
    "stress", "energy", "workout", "exercise", "diet", "weight", "hospital", "sick", "ill", "fever",
    "headache", "cold", "cough", "vitamin", "therapy", "mental", "breath", "breathing", "rest",
    "bedtime", "wellness", "injury", "symptom",
  ]),
  tech: new Set([
    "phone", "computer", "laptop", "app", "application", "internet", "wifi", "battery", "update",
    "device", "software", "hardware", "screen", "password", "download", "upload", "install",
    "network", "data", "cloud", "file", "click", "keyboard", "mouse", "charger", "cable",
    "bluetooth", "headphone", "headphones", "camera", "video", "browser", "website", "server",
    "program", "code", "settings",
  ]),
};
