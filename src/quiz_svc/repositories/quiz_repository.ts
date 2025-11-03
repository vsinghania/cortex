import type { Connection } from 'mongoose';
import { Schema } from 'mongoose';
import type { Quiz } from '../types/quiz.types.js';
import type { QuizRepository } from './quiz_repository_interface.js';
import { MongooseConnectionManager } from '../../db/mongo/mongoose_connection_manager.js';
import { BaseModelFactory } from '../../db/mongo/base_model_factory.js';

// Keep domain conversion narrow and consistent
function toDomain(doc: any): Quiz {
  const obj = typeof doc?.toJSON === 'function' ? doc.toJSON() : doc;
  return obj as Quiz;
}

// Module-private model factory to encapsulate schema/model.
// The model is created per-Connection and never exported.
class QuizModelFactory extends BaseModelFactory<Quiz> {

  protected buildSchema(): Schema<Quiz> {
    const DifficultyLevels = ['easy', 'medium', 'hard'] as const;
    const QuestionTypes = ['multiple_choice', 'true_false', 'subjective'] as const;
    const QuizCategories = ['cricket', 'soccer', 'tennis', 'world_history', 'indian_history', 'american_history'] as const;

    const QuestionSubSchema = new Schema(
      {
        question_id: { type: String, required: true },
        question_text: { type: String, required: true },
        difficulty_level: { type: String, enum: DifficultyLevels, required: true },
        question_type: { type: String, enum: QuestionTypes, required: true },
        answer_options: { type: [String], default: undefined },
        points: { type: Number, default: undefined },
        category: { type: String, enum: QuizCategories, required: true }
      },
      { _id: false }
    );

    const QuizSchemaMongoose = new Schema(
      {
        quiz_id: { type: String, required: true, index: true, unique: true },
        questions: {
          type: [QuestionSubSchema],
          required: true,
          validate: {
            validator: (v: unknown[]) => Array.isArray(v) && v.length > 0,
            message: 'questions must be a non-empty array'
          }
        },
        min_points: { type: Number, default: undefined },
        categories: { type: [String], enum: QuizCategories, required: true }
      },
      {
        collection: 'quizzes',
        versionKey: false,
        timestamps: true
      }
    );

    // Indexes
    QuizSchemaMongoose.index({ quiz_id: 1 }, { unique: true });

    // Output shaping
    QuizSchemaMongoose.set('toJSON', {
      transform(_doc, ret) {
        Reflect.deleteProperty(ret as any, '_id');
        return ret;
      }
    });

    return QuizSchemaMongoose;
  }

  protected getModelName(): string {
    return 'Quiz';
  }
}

export class MongooseQuizRepository implements QuizRepository {
  private static readonly factory = new QuizModelFactory();

  private constructor(
    private readonly conn: Connection,
    private readonly model: any
  ) {}

  // Async factory to create a repository bound to a specific db (and optional host/port)
  static async create(params: { db: string; host?: string; port?: number }) {
    const mgr = await MongooseConnectionManager.getInstance();
    const conn = await mgr.getDbConnection(params);
    const model = this.factory.getModel(conn);
    return new MongooseQuizRepository(conn, model);
  }

  async createQuiz(quiz: Quiz): Promise<Quiz> {
    const created = await this.model.create(quiz);
    return toDomain(created);
  }

  async getQuizById(quiz_id: string): Promise<Quiz | null> {
    const found = await this.model.findOne({ quiz_id }).lean();
    return found ? (toDomain(found) as Quiz) : null;
  }

  async listQuizzes(params?: { limit?: number; cursor?: string }): Promise<{ items: Quiz[]; next_cursor?: string }> {
    const limit = Math.max(1, Math.min(100, params?.limit ?? 20));
    const cursor = params?.cursor;

    const filter: any = {};
    if (cursor) {
      // simple forward pagination on quiz_id (lexicographic)
      filter.quiz_id = { $gt: cursor };
    }

    const items = await this.model.find(filter).sort({ quiz_id: 1 }).limit(limit + 1).lean();

    let next_cursor: string | undefined;
    if (items.length > limit) {
      const next = items.pop()!;
      next_cursor = next.quiz_id;
    }

    return {
      items: items.map((i: any) => toDomain(i)),
      next_cursor
    };
  }

  async updateQuiz(quiz_id: string, patch: Partial<Quiz>): Promise<Quiz | null> {
    // whitelist updatable fields
    const allowed: Partial<Quiz> = {};
    if (patch.questions !== undefined) allowed.questions = patch.questions as any;
    if (patch.min_points !== undefined) allowed.min_points = patch.min_points as any;
    if (patch.categories !== undefined) allowed.categories = patch.categories as any;

    const updated = await this.model.findOneAndUpdate(
      { quiz_id },
      { $set: allowed },
      { new: true }
    ).lean();

    return updated ? (toDomain(updated) as Quiz) : null;
  }

  async deleteQuiz(quiz_id: string): Promise<boolean> {
    const res = await this.model.deleteOne({ quiz_id });
    return (res.deletedCount ?? 0) > 0;
  }
}
