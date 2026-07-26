/**
 * Ask user question tool — presents questions to the user for interactive input.
 *
 */

export const ASK_USER_QUESTION_TOOL_NAME = 'ask_user_question';

export interface Question {
  question: string;
  options: QuestionOption[];
  multiSelect?: boolean;
  allowFreeform?: boolean;
}

export interface QuestionOption {
  label: string;
  description?: string;
  preview?: string;
}

export interface AskUserQuestionInput {
  questions: Question[];
}

export interface AskUserQuestionOutput {
  answers: QuestionAnswer[];
}

export interface QuestionAnswer {
  questionIndex: number;
  selectedLabels: string[];
  notes?: string;
}

export interface AskUserQuestionExtRequest {
  sessionId: string;
  toolCallId: string;
  questions: Question[];
  mode: AskUserQuestionMode;
}

export enum AskUserQuestionMode {
  Default = 'default',
  Plan = 'plan',
}

export interface QuestionAnnotation {
  preview?: string;
  notes?: string;
}

export interface AskUserQuestionExtResponse {
  outcome: 'accepted' | 'cancelled';
  answers?: Record<string, string[]>;
  annotations?: Record<string, QuestionAnnotation>;
}

/**
 * Validate question input.
 */
export function validateQuestions(questions: Question[]): string | null {
  if (!questions || questions.length === 0) {
    return 'At least one question is required';
  }

  for (const q of questions) {
    if (!q.question || q.question.trim().length === 0) {
      return 'Question text is required';
    }
    if (!q.options || q.options.length === 0) {
      return `Question "${q.question}" must have at least one option`;
    }
    for (const opt of q.options) {
      if (!opt.label || opt.label.trim().length === 0) {
        return `Option label is required for question "${q.question}"`;
      }
    }
  }

  return null;
}

export const ASK_USER_QUESTION_DESCRIPTION = `
Ask the user one or more questions with predefined options.
The user can select one or more options, or provide freeform text if enabled.
`.trim();
