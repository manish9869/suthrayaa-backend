// Default copy for the policy pages — extracted verbatim from the original hardcoded storefront
// pages. Bodies use the storefront's markdown-lite format (see content.catalog.ts). Admins edit
// these in Admin → Storefront Content; a saved edit overrides the default.

export const POLICY_DEFAULTS = {
  "privacy": {
    "eyebrow": "Legal",
    "title": "Privacy Policy",
    "description": "Last updated: January 2026. Your privacy matters to us — here's exactly what we collect and why.",
    "sections": [
      {
        "title": "1. Information We Collect",
        "body": "When you browse or shop with us, we may collect:\n\n- **Account & contact details** — name, email, phone number, and shipping address.\n- **Order information** — items purchased, customization details, and payment status (not full card numbers — those are handled directly by Razorpay).\n- **Usage data** — pages visited and items browsed, used to improve the shopping experience."
      },
      {
        "title": "2. How We Use Your Information",
        "body": "We use your information to:\n\n- Process and deliver your orders, including any customizations you request.\n- Send order updates, shipping notifications, and (only if you opt in) newsletter emails.\n- Respond to support requests and improve our products and site.\n- Prevent fraud and keep our store secure."
      },
      {
        "title": "3. Sharing Your Information",
        "body": "We don't sell your personal data. We only share what's necessary with trusted partners who help us run the business — our courier partners (to deliver your order) and Razorpay (to process online payments securely). Each of these partners is bound to use your data only for the service they provide us."
      },
      {
        "title": "4. Cookies & Local Storage",
        "body": "Our site uses browser storage to remember your cart and wishlist between visits, and basic analytics cookies to understand how the site is used. You can clear these at any time through your browser settings."
      },
      {
        "title": "5. Your Rights",
        "body": "You can ask us to access, correct, or delete the personal information we hold about you at any time by emailing {{email}}. We'll respond within a reasonable timeframe."
      },
      {
        "title": "6. Data Security",
        "body": "We use industry-standard measures to protect your data, and all payments are processed over encrypted connections. No online system is 100% risk-free, but we take reasonable steps to keep your information safe."
      },
      {
        "title": "7. Changes to This Policy",
        "body": "We may update this policy as our practices evolve. Significant changes will be reflected by an updated \"last updated\" date above."
      },
      {
        "title": "8. Contact Us",
        "body": "For any privacy-related questions, reach us at {{email}}."
      }
    ]
  },
  "terms": {
    "eyebrow": "Legal",
    "title": "Terms & Conditions",
    "description": "Last updated: January 2026. Please read these terms carefully before using our website or placing an order.",
    "sections": [
      {
        "title": "1. About These Terms",
        "body": "These terms and conditions govern your use of the Suthrayaa website and any purchase you make with us. By browsing our site or placing an order, you agree to these terms. If you don't agree with any part of them, please don't use the site."
      },
      {
        "title": "2. Handmade, Made-to-Order Products",
        "body": "Every piece on Suthrayaa is handcrafted, and many are made to order. Because of this:\n\n- Slight variations in colour, size, and pattern between the photo and the finished piece are normal and part of the handmade charm.\n- Processing times shown on each product page are estimates, not guarantees — handmade work occasionally takes a little longer, especially during festive seasons.\n- Personalized or customized items are made specifically for you and can't be resold, so please double-check your customization details before ordering."
      },
      {
        "title": "3. Orders & Pricing",
        "body": "All prices are listed in Indian Rupees (INR) and include applicable taxes unless stated otherwise. We reserve the right to correct pricing errors and to cancel and refund an order placed at an incorrect price before it ships. Once an order is placed, you'll receive a confirmation email or SMS with your order number."
      },
      {
        "title": "4. Payments",
        "body": "We accept Cash on Delivery and online payments (UPI, cards, netbanking, and wallets) via Razorpay. Online payments are processed securely by Razorpay — we never store your card details on our servers."
      },
      {
        "title": "5. Intellectual Property",
        "body": "All designs, photographs, and content on this site are the property of Suthrayaa and may not be reproduced, copied, or used commercially without our written permission."
      },
      {
        "title": "6. Limitation of Liability",
        "body": "We work hard to make sure every order is accurate and arrives safely, but we aren't liable for delays or issues caused by circumstances outside our control, including courier delays, natural events, or incorrect shipping information provided at checkout."
      },
      {
        "title": "7. Changes to These Terms",
        "body": "We may update these terms from time to time as our shop grows. The \"last updated\" date at the top of this page will always reflect the most recent version."
      },
      {
        "title": "8. Contact Us",
        "body": "Questions about these terms? Reach us at {{email}} or through our [Contact page](/contact)."
      }
    ]
  },
  "returns": {
    "eyebrow": "Support",
    "title": "Returns & Refunds",
    "description": "We want you to love your handmade piece. If something isn't right, here's how we make it right.",
    "sections": [
      {
        "title": "Our 7-Day Return Window",
        "body": "You can request a return within **7 days** of delivery for eligible items. To start a return, email {{email}} or use our [Contact page](/contact) with your order number and a photo of the item — we'll take it from there."
      },
      {
        "title": "What's Eligible",
        "body": "- Ready-to-ship items in original, unused condition with tags/packaging intact.\n- Items that arrived damaged, defective, or different from what you ordered."
      },
      {
        "title": "What's Not Eligible",
        "body": "Because each piece is handcrafted specifically for you, the following can't be returned unless they arrive damaged or defective:\n\n- Personalized or customized items (name keychains, custom colors, custom text, etc.)\n- Made-to-order and custom-order pieces\n- Items marked \"Clearance\" or final sale"
      },
      {
        "title": "How Returns Work",
        "body": ""
      },
      {
        "title": "Exchanges",
        "body": "Prefer a different color or design instead of a refund? Let us know when you reach out — we're happy to arrange an exchange for eligible items, subject to stock availability."
      }
    ]
  },
  "refund-policy": {
    "eyebrow": "Support",
    "title": "Refund Policy",
    "description": "Once a return is approved, here's exactly how and when you'll get your money back.",
    "sections": [
      {
        "title": "Refund Timeline",
        "body": "Once we receive and inspect your returned item, we'll notify you by email whether the refund is approved. Approved refunds are processed within **5–7 business days**."
      },
      {
        "title": "Refund Method",
        "body": "- **Online payments (Razorpay)** — refunded to the original payment method. Banks typically take an additional 3–5 business days to reflect it.\n- **Cash on Delivery orders** — refunded via bank transfer or UPI; we'll ask for your preferred details when the return is approved.\n- **Store credit** — available on request, issued instantly and valid on any future order."
      },
      {
        "title": "Cancellations Before Shipping",
        "body": "Since most pieces are made to order, you can cancel for a full refund within **24 hours** of placing your order, before crafting begins. After that, your piece is already being handmade, so cancellation may not be possible — contact us as soon as possible and we'll always try to help."
      },
      {
        "title": "Damaged or Incorrect Items",
        "body": "If your order arrives damaged, defective, or different from what you ordered, you're entitled to a full refund or free replacement — no questions asked. Just reach out within 7 days of delivery with photos of the item and packaging."
      },
      {
        "title": "Non-Refundable Items",
        "body": "Personalized/customized pieces and items marked \"Clearance\" are final sale and not eligible for refund, unless they arrive damaged or defective. See our full [Returns & Refunds](/returns) page for eligibility details."
      },
      {
        "title": "Questions About a Refund?",
        "body": "Email us at {{email}} with your order number and we'll help right away."
      }
    ]
  },
  "shipping": {
    "eyebrow": "Support",
    "title": "Shipping Info",
    "description": "Every piece is handmade to order — here's what to expect from checkout to your doorstep.",
    "sections": [
      {
        "title": "Processing Time",
        "body": "Since most of our pieces are handcrafted after you order, please allow **3–5 business days** for us to make your item before it ships. Personalized or customized pieces may take an additional **1–2 days**. Each product page shows an estimated delivery window — that already accounts for crafting time."
      },
      {
        "title": "Delivery Time",
        "body": "- **Standard Delivery** — 5–7 business days after your order ships (Rs. 49, free above Rs. 999).\n- **Express Delivery** — 2–3 business days after your order ships (Rs. 99).\n\nDelivery estimates are for major cities — remote pincodes may take a couple of extra days."
      },
      {
        "title": "Order Tracking",
        "body": "Once your order ships, we'll email and SMS you a tracking link. You can also check your order status any time from your account, or use our [orders page](/account/orders)."
      },
      {
        "title": "Shipping Charges",
        "body": "Shipping is **free on all prepaid orders above Rs. 999**. Orders below that, and Cash-on-Delivery orders, carry a flat shipping fee shown at checkout before you pay."
      },
      {
        "title": "International Shipping",
        "body": "We currently ship within India only. We're working on bringing Suthrayaa to more places soon — sign up for our newsletter to be the first to know."
      }
    ]
  }
} as const;
