import { Schema, model, models, type Model, Types } from "mongoose";

export type EasyType = "send" | "receive" | "bill" | "easyload" | "jazzcash" | "deposit" | "withdraw";

export interface IEasypaisa {
  customerName: string;
  phone?: string;
  type: EasyType;
  amount: number;
  commission: number;
  totalAmount: number;
  userId: Types.ObjectId;
  localId?: string;
  synced?: boolean | number;
  createdAt?: Date;
  updatedAt?: Date;
}

const EasypaisaSchema = new Schema<IEasypaisa>({
  customerName: { type: String, default: "Walk-in", trim: true, index: true },
  phone: { type: String, default: "", trim: true },
  type: { 
    type: String, 
    enum: ["send","receive","bill","easyload","jazzcash","deposit","withdraw"], 
    required: true, 
    index: true 
  },
  amount: { type: Number, required: true, min: 0 },
  commission: { type: Number, default: 0, min: 0 },
  totalAmount: { type: Number, default: 0 },
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  localId: { type: String, index: true, trim: true },
  synced: { type: Schema.Types.Mixed, default: true }, // allow 0/1 from offlineDB
}, { timestamps: true });

// Compound unique to prevent double sync — same user + same localId = one doc
EasypaisaSchema.index({ userId: 1, localId: 1 }, { unique: true, sparse: true });
EasypaisaSchema.index({ userId: 1, createdAt: -1 });
EasypaisaSchema.index({ userId: 1, type: 1, createdAt: -1 });

// Asad charges whole rupees
EasypaisaSchema.pre("validate", function() {
  this.amount = Math.round(this.amount || 0);
  this.commission = Math.round(this.commission || 0);
  this.totalAmount = this.amount + this.commission;
});

const Easypaisa = (models.Easypaisa as Model<IEasypaisa>) || model<IEasypaisa>("Easypaisa", EasypaisaSchema);
export default Easypaisa;