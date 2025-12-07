import { initializeApp } from 'firebase/app';
import { getDatabase } from 'firebase/database';

const firebaseConfig = {
  apiKey: "AIzaSyDyhJKh9-nElxZ6bpK5EFk7r2wy0oy8u1M",
  authDomain: "mes-recettes-1bd22.firebaseapp.com",
  databaseURL: "https://mes-recettes-1bd22-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "mes-recettes-1bd22",
  storageBucket: "mes-recettes-1bd22.firebasestorage.app",
  messagingSenderId: "813094403524",
  appId: "1:813094403524:web:6413eb377c018ff419f891",
  measurementId: "G-TV87LZRMC8"
};

const app = initializeApp(firebaseConfig);
const database = getDatabase(app);

export { database };
