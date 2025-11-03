import { OpenAiAdapter } from '../ai_svc/adapters/openai_adapter.js';
import { PromptRequest, Role } from '../ai_svc/types/ai_prompt.types.js';
import { Answer, AnswerSchema, Question, QuestionType, Quiz, QuizCategory, QuizGenRequest, QuizGenRequestSchema, QuizGrade, QuizResult, QuizResultSchema, QuizSchema } from './types/quiz.types.js';
import { z } from 'zod';


// TODO: Quiz Svc should not use the ai adapter directly and should rather use the ai svc/
// Quiz svc (or any other external svc to AI svc) can provide details based on which the ai svc can choose the appropriate adapter.


export class QuizSvc {

  // Stateless.
  async verifyAnswers(questions: Question[], answers: Answer[]): Promise<Answer[]> {
    const parts: string[] = [];

    parts.push(`You have to evaluate answers against a set of questions asked in a quiz.\
      Some may be multiple-choice, some maybe subjective or some maybe true/false. Evaluate accordingly.\
      Use question_id to map questions to answers. If there is no answer for a question, allot zero points for that in response and set skipped as true. If there is an answer for which there is no question, ignore that answer.\
      No need to append the question text back to the response.\
      Return response in json format using the schema provided.\n Here are the questions: ${JSON.stringify(questions)}\n And here are the answers: ${JSON.stringify(answers)}`);

    const prompt_txt = parts.join(" ");
    const genai_prompt: PromptRequest = {
      latest_prompt: {
        role: Role.SYSTEM,
        content: prompt_txt
      },
      message_history: [],
      output_schema: {
        schema: z.object({answers: z.array(AnswerSchema)}),
        name: 'answers'
      }
    };
    const ai_adapter = new OpenAiAdapter();
    const response = await ai_adapter.generateJsonOutput(genai_prompt);
    return (response.response_json as {answers: Answer[]}).answers;
  }

  // Evaluate entire quiz.
  async evaluateQuiz(quiz: Quiz, answers: Answer[]): Promise<QuizResult> {
    const questions = quiz.questions ?? [];
    answers = answers ?? [];
    if (!questions.length || !answers.length) {
      throw new Error("Quiz has no questions to evaluate.");
    }
    const evaled_answers = await this.verifyAnswers(questions, answers);
    let points_scored = 0, total_points = 0;
    evaled_answers.forEach((ans) => points_scored += (ans.points_earned ?? 0));
    questions.forEach((q) => total_points += (q.points ?? 0));

    let grade: QuizGrade = QuizGrade.F;
    if (points_scored >= total_points * 0.9) {
      grade = QuizGrade.A;
    } else if (points_scored >= total_points * 0.75) {
      grade = QuizGrade.B;
    } else if (points_scored >= total_points * 0.5) {
      grade = QuizGrade.C;
    }

    const quiz_result: QuizResult = {
      quiz_id: quiz.quiz_id,
      answers: evaled_answers,
      points_scored,
      grade
    };

    return quiz_result;
  }

  async generateQuiz(request: QuizGenRequest): Promise<Quiz> {

    const prompt_text = this.buildQuizPrompt(request);
    const genai_prompt: PromptRequest = {
      latest_prompt: {
        role: Role.SYSTEM,
        content: prompt_text
      },
      message_history: [],
      output_schema: {
        schema: QuizSchema,
        name: 'quiz'
      }
    };
    const ai_adapter = new OpenAiAdapter();
    const response = await ai_adapter.generateJsonOutput(genai_prompt);
    return response.response_json as Quiz;
  }

  private buildQuizPrompt(req: QuizGenRequest): string {
    const parts: string[] = [];

    req.num_questions = req.num_questions || 10;
    parts.push(`Generate a quiz with ${req.num_questions} questions.`);
    req.categories = req.categories?.length ? req.categories : Object.values(QuizCategory);
    parts.push(
      `The quiz should cover the following categories: ${req.categories.join(", ")}.`
    );


    if (req.difficulty_levels) {
      const diffParts = Object.entries(req.difficulty_levels)
        .map(([level, count]) => `${count} ${level}`)
        .join(", ");
      parts.push(`Difficulty distribution by percentage: ${diffParts}. If distribution adds to below 100 or exceeds 100, adjust based on your best judgement but dont cross total questions beyond the limit provided.`);
    }
    req.types = req.types ?? {} as Record<QuestionType, number>;
    if (Object.keys(req.types).length) {
      req.types[QuestionType.MultipleChoice] = 100;
    }
    const typeParts = Object.entries(req.types)
      .map(([type, count]) => `${count} ${type}`)
      .join(", ");
    parts.push(`Question type distribution: ${typeParts}.`);

    req.total_points = req.total_points || (req.num_questions ? req.num_questions * 10 : 100);
    if (req.total_points) {
      parts.push(`The quiz should total ${req.total_points} points.`);
    }

    parts.push(
      `Provide each question with its multiple options if applicable.`
    );

    parts.push(
      `Assign a uuid to question_id for each question and quiz_id for the quiz. Generate the quiz. Return only valid JSON matching the schema. No prose.`
    );

    return parts.join(" ");
  }

}