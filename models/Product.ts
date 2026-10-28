import mongoose, { Schema, Document, Types } from "mongoose";

export type ProductCategory = "mobile_accessories" | "manyari" | "cosmetics" | "other";
export type StockMode = "limited" | "unlimited";

export interface IProduct extends Document {
  name: string;
  category: ProductCategory;
  company?: string;
  buyPriceAvg: number; // Asad: your main buy price
  sellPrice: number;
  stock: number;
  stockMode: StockMode;
  userId: Types.ObjectId;
  localId?: string;
  synced?: boolean;
  lastSyncedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const ProductSchema = new Schema<IProduct>({
  name: { type: String, required: true, trim: true, index: true },
  category: { 
    type: String, 
    enum: ["mobile_accessories","manyari","cosmetics","other"], 
    default: "mobile_accessories", 
    index: true 
  },
  company: { type: String, default: "", trim: true },
  buyPriceAvg: { type: Number, default: 0, min: 0, required: true },
  sellPrice: { type: Number, required: true, min: 0 },
  stock: { type: Number, default: 0, min: 0 },
  stockMode: { 
    type: String, 
    enum: ["limited","unlimited"], 
    default: "limited",
    index: true 
  },
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  localId: { type: String, sparse: true, index: true },
  synced: { type: Boolean, default: true },
  lastSyncedAt: { type: Date, default: Date.now },
}, { 
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// INDEXES
ProductSchema.index({ userId: 1, category: 1, createdAt: -1 });
ProductSchema.index({ userId: 1, stock: 1 });
ProductSchema.index({ userId: 1, name: 1 });

// Virtuals - whole rupees
ProductSchema.virtual("profit").get(function(this: IProduct){
  return Math.round((this.sellPrice || 0) - (this.buyPriceAvg || 0));
});

ProductSchema.virtual("totalBuyValue").get(function(this: IProduct){
  if (this.stockMode === "unlimited") return 0;
  return Math.round((this.stock || 0) * (this.buyPriceAvg || 0));
});

ProductSchema.virtual("totalSellValue").get(function(this: IProduct){
  if (this.stockMode === "unlimited") return 0;
  return Math.round((this.stock || 0) * (this.sellPrice || 0));
});

// For backward compat if some API sends buyPrice
ProductSchema.virtual("buyPrice").get(function(this: IProduct){
  return this.buyPriceAvg;
}).set(function(this: IProduct, v: number){
  this.buyPriceAvg = Math.round(v || 0);
});

ProductSchema.pre("save", function() {
  if (this.stockMode === "unlimited") {
    this.stock = 999999;
  }
  this.buyPriceAvg = Math.round(this.buyPriceAvg || 0);
  this.sellPrice = Math.round(this.sellPrice || 0);
});

export default mongoose.models.Product || mongoose.model<IProduct>("Product", ProductSchema);