# Firebase সেটআপ (একবারের কাজ)

## ১. Firebase প্রজেক্ট
1. https://console.firebase.google.com → **Add project**
2. **Build → Authentication → Get started → Sign-in method → Email/Password** চালু করুন
3. **Authentication → Users → Add user** দিয়ে নিজের (এডমিনের) ইমেইল ও পাসওয়ার্ড বানান
4. **Build → Firestore Database → Create database** (Production mode)
5. **Build → Storage → Get started**
6. **Project settings → Your apps → Web (`</>`)** → অ্যাপ রেজিস্টার করে কনফিগ কপি করুন
7. `script.js` ফাইলের একদম উপরে `firebaseConfig` এর মানগুলো বসান

## ২. Rules
Firebase CLI দিয়ে (`npm i -g firebase-tools` → `firebase login` → `firebase init` বা সরাসরি):

```
firebase deploy --only firestore:rules,storage
```
অথবা Console-এ `firestore.rules` ও `storage.rules` এর লেখা কপি-পেস্ট করুন।

## ৩. Storage CORS (ছবি/স্বাক্ষর প্রিন্ট ও JPG/PDF শেয়ারের জন্য জরুরি)
Google Cloud Shell বা gsutil দিয়ে একবার চালান (বাকেটের নাম Storage পেজের উপরে দেখা যায়):

```
gsutil cors set cors.json gs://YOUR_PROJECT_ID.appspot.com
```
(নতুন প্রজেক্টে বাকেটের নাম `YOUR_PROJECT_ID.firebasestorage.app` হতে পারে।)

## ৪. Hosting (ঐচ্ছিক)
```
firebase deploy --only hosting
```
লোগো `assests/logo.png` ও `assests/logo2.jpg` আগের মতোই প্রজেক্ট ফোল্ডারে রাখুন।

## ডেটা কোথায় থাকে
- `houses/{বাসা}` → নাম, ঠিকানা, ভাড়াটিয়া সংখ্যা
- `houses/{বাসা}/tenants/{ভাড়াটিয়া}` → ফর্মের তথ্য + সিরিয়াল
- Storage: `houses/{বাসা}/tenants/{ভাড়াটিয়া}/` → ছবি ও স্বাক্ষর
