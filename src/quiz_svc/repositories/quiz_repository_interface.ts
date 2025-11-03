import type { Quiz } from '../types/quiz.types.js';

export interface QuizRepository {
  createQuiz(quiz: Quiz): Promise<Quiz>;
  getQuizById(quiz_id: string): Promise<Quiz | null>;
  listQuizzes(params?: { limit?: number; cursor?: string }): Promise<{ items: Quiz[]; next_cursor?: string }>;
  updateQuiz(quiz_id: string, patch: Partial<Quiz>): Promise<Quiz | null>;
  deleteQuiz(quiz_id: string): Promise<boolean>;
}
