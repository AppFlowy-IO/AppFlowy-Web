export enum AIAssistantType {
  ImproveWriting = 1,
  FixSpelling = 2,
  MakeShorter = 3,
  MakeLonger = 4,
  ContinueWriting = 5,
  Explain = 6,
  AskAIAnything = 7,
  CustomPrompt = 8
}

export enum CompletionRole {
  AI = 'ai',
  Human = 'human'
}

export interface CompletionResult {
  role: CompletionRole;
  content: string;
}

