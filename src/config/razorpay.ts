import Razorpay from "razorpay";
import { env } from "./env.js";

export const razorpay = new Razorpay({
  key_id: env.RAZORPAY_KEY_ID,
  key_secret: env.RAZORPAY_KEY_SECRET,
});

export const isRazorpayLive = env.RAZORPAY_KEY_ID.startsWith("rzp_live_");
