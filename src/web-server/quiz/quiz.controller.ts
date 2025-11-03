import express from 'express';
import { logger } from '../../common/logger.js';
import { Answer, AnswerSchema, Question, QuestionSchema, Quiz, QuizGenRequest, QuizGenRequestSchema, QuizSchema } from '../../quiz_svc/types/quiz.types.js';
import { QuizSvc } from '../../quiz_svc/quiz_svc.js';
import { z } from 'zod';
import { validate } from '../../common/middlewares/validate.js';
import { validateRequest } from '../../lib/decorators/validation_decorators.js';

export class QuizController {

  private readonly router: express.Router;

  constructor() {
    this.router = express.Router();
    this.registerRoutes();
  }

  public getRouter() {
    return this.router;
  }

  private registerRoutes() {
    this.router.post('/gen-quiz', this.generateQuiz.bind(this));
    this.router.post('/eval-answers', this.evalAnswers.bind(this));
    this.router.post('/eval-quiz', this.evalQuiz.bind(this));
  }

  @validateRequest({body: QuizGenRequestSchema})
  private async generateQuiz(req: express.Request, res: express.Response, next: express.NextFunction) {
    try {
      const quiz_gen_req = req.body as QuizGenRequest;
      const quiz_svc = new QuizSvc();
      const quiz = await quiz_svc.generateQuiz(quiz_gen_req);
      res.status(200).json({ response: quiz });
    } catch (e) {
      next(e);
    }
  }

  @validateRequest({body: z.object({questions: z.array(QuestionSchema), answers: z.array(AnswerSchema)})})
  private async evalAnswers(req: express.Request, res: express.Response, next: express.NextFunction) {
    try {
      const {
        questions,
        answers
      } = req.body as { questions: Question[]; answers: Answer[] };
      const quiz_svc = new QuizSvc();
      const evaled_answers = await quiz_svc.verifyAnswers(questions, answers);
      res.status(200).json({ response: evaled_answers });
      return;
    } catch (e) {
      next(e);
    }
  }

  @validateRequest({body: z.object({quiz: QuizSchema, answers: z.array(AnswerSchema)})})
  private async evalQuiz(req: express.Request, res: express.Response, next: express.NextFunction) {
    try {
      const {
        quiz,
        answers
      } = req.body as { quiz: Quiz; answers: Answer[] };
      const quiz_svc = new QuizSvc();
      const quiz_result = await quiz_svc.evaluateQuiz(quiz, answers);
      res.status(200).json({ response: quiz_result });
      return;
    } catch (e) {
      next(e);
    }
  }
}
