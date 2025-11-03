import { z } from 'zod';

export enum QuizCategory {
  Cricket = 'cricket',
  Soccer = 'soccer',
  Tennis = 'tennis',
  WorldHistory = 'world_history',
  IndianHistory = 'indian_history',
  AmericanHistory = 'american_history'
}

export enum QuizGrade {
  A = 'A',
  B = 'B',
  C = 'C',
  F = 'F'
}

export enum DifficultyLevel {
  Easy = 'easy',
  Medium = 'medium',
  Hard = 'hard'
}

export enum QuestionType {
  MultipleChoice = 'multiple_choice',
  TrueFalse = 'true_false',
  Subjective = 'subjective'
}

export const QuestionSchema = z.object({
  question_id: z.string().min(1),
  question_text: z.string().min(1),
  difficulty_level: z.enum([DifficultyLevel.Easy, DifficultyLevel.Medium, DifficultyLevel.Hard]),
  question_type: z.enum([QuestionType.MultipleChoice, QuestionType.TrueFalse, QuestionType.Subjective]),
  answer_options: z.array(z.string()).optional().nullable(),
  points: z.number().optional().nullable(),
  category: z.enum([QuizCategory.Cricket, QuizCategory.Soccer, QuizCategory.Tennis, QuizCategory.WorldHistory, QuizCategory.IndianHistory, QuizCategory.AmericanHistory])
});

export const AnswerSchema = z.object({
  question_id: z.string().min(1),
  answer_text: z.string(),
  points_earned: z.number().optional().nullable(),
  skipped: z.boolean().optional().nullable()
});

export const QuizResultSchema = z.object({
  quiz_id: z.string().min(1),
  points_scored: z.number().min(0),
  answers: z.array(AnswerSchema).min(1),
  grade: z.enum([QuizGrade.A, QuizGrade.B, QuizGrade.C, QuizGrade.F]).optional().nullable()
});

export const QuizSchema = z.object({
  quiz_id: z.string().min(1),
  questions: z.array(QuestionSchema).min(1),
  min_points: z.number().min(0).optional().nullable(),
  categories: z.array(z.enum([QuizCategory.Cricket, QuizCategory.Soccer, QuizCategory.Tennis, QuizCategory.WorldHistory, QuizCategory.IndianHistory, QuizCategory.AmericanHistory]))
});

export const QuizGenRequestSchema = z.object({
  categories: z.array(z.enum([QuizCategory.Cricket, QuizCategory.Soccer, QuizCategory.Tennis, QuizCategory.WorldHistory, QuizCategory.IndianHistory, QuizCategory.AmericanHistory])).optional(),
  difficulty_levels: z.record(z.enum([DifficultyLevel.Easy, DifficultyLevel.Medium, DifficultyLevel.Hard]), z.number().min(1)).optional(),
  num_questions: z.number().min(1),
  types: z.record(z.enum([QuestionType.MultipleChoice, QuestionType.TrueFalse, QuestionType.Subjective]), z.number().min(1)).optional(),
  total_points: z.number().optional()
});

export type Question = z.infer<typeof QuestionSchema>;
export type Answer = z.infer<typeof AnswerSchema>;
export type QuizResult = z.infer<typeof QuizResultSchema>;
export type Quiz = z.infer<typeof QuizSchema>;
export type QuizGenRequest = z.infer<typeof QuizGenRequestSchema>;


