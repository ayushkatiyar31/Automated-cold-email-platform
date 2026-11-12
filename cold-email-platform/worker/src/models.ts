import mongoose, { Mongoose, Schema } from 'mongoose';

const uploadSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, required: true },
  campaignId: { type: Schema.Types.ObjectId, required: true },
  originalName: String,
  mimeType: String,
  size: Number,
  gridFsId: { type: Schema.Types.ObjectId, required: true },
  status: { type: String, index: true },
  error: String,
  queuedAt: Date,
  statusChangedAt: Date,
  rowsScanned: { type: Number, default: 0 },
  recipientsFound: { type: Number, default: 0 },
  recipientsInserted: { type: Number, default: 0 }
}, { timestamps: true });

const recipientSchema = new Schema({
  campaignId: { type: Schema.Types.ObjectId, required: true },
  userId: { type: Schema.Types.ObjectId, required: true },
  email: { type: String, required: true, lowercase: true, trim: true },
  name: String,
  company: String,
  status: { type: String, enum: ['pending', 'sending', 'sent', 'failed', 'skipped', 'invalid'], default: 'pending' },
  attempts: { type: Number, default: 0 },
  error: String,
  errorCode: String,
  gmailMessageId: String,
  sentAt: Date,
  nextAttemptAt: Date,
  idempotencyKey: { type: String, required: true },
  updatedAt: Date
}, { timestamps: true });
recipientSchema.index({ campaignId: 1, email: 1 }, { unique: true });
recipientSchema.index({ campaignId: 1, idempotencyKey: 1 }, { unique: true });

const campaignSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, required: true },
  name: String,
  subject: String,
  body: String,
  resumeLink: String,
  includeResumeLink: { type: Boolean, default: true },
  optOutEnabled: Boolean,
  optOutLine: String,
  status: String,
  pauseReason: String,
  counts: Object
}, { timestamps: true });

const userSchema = new Schema({
  name: String,
  email: String,
  gmail: { email: String, accessToken: String, refreshToken: String, expiryDate: Number }
}, { timestamps: true });

const emailLogSchema = new Schema({
  userId: Schema.Types.ObjectId,
  campaignId: Schema.Types.ObjectId,
  recipientId: Schema.Types.ObjectId,
  recipientEmail: String,
  providerMessageId: String,
  status: String,
  error: String,
  errorCode: String,
  idempotencyKey: String
}, { timestamps: true });
emailLogSchema.index({ campaignId: 1, idempotencyKey: 1 }, { unique: true });

function getModel(instance: Mongoose, name: string, schema: Schema) {
  return instance.models[name] ?? instance.model(name, schema);
}

export function createWorkerModels(instance: Mongoose = mongoose) {
  return {
    Upload: getModel(instance, 'Upload', uploadSchema),
    Recipient: getModel(instance, 'Recipient', recipientSchema),
    Campaign: getModel(instance, 'Campaign', campaignSchema),
    User: getModel(instance, 'User', userSchema),
    EmailLog: getModel(instance, 'EmailLog', emailLogSchema)
  };
}

export type WorkerModels = ReturnType<typeof createWorkerModels>;
