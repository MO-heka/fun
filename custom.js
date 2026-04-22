// ============================================================
// CUSTOM CATEGORY - Template for adding your own questions
// ============================================================
window.CATEGORIES = window.CATEGORIES || {};

window.CATEGORIES.custom = {
  id: 'custom',
  name: 'فئة مخصصة',
  icon: '⭐',
  color: '#FF9800',
  questions: [
    { q: 'سؤالك الأول هنا؟', a: ['الإجابة الأولى', 'alternative answer'], difficulty: 'easy' },
    { q: 'سؤالك الثاني هنا؟', a: ['إجابة سؤال 2'], difficulty: 'medium' },
    { q: 'سؤالك الثالث هنا؟', a: ['إجابة سؤال 3'], difficulty: 'hard' },
    // أضف المزيد من الأسئلة هنا بنفس الصيغة
    // { q: 'السؤال؟', a: ['الإجابة', 'بديل للإجابة'], difficulty: 'easy' | 'medium' | 'hard' }
  ]
};

// ============================================================
// HOW TO ADD QUESTIONS:
// 1. Copy any object from the questions array
// 2. Change 'q' to your question text
// 3. Change 'a' to an array of accepted answers (case-insensitive matching is applied)
// 4. Set difficulty to 'easy', 'medium', or 'hard'
// 5. Save the file and reload the game
// ============================================================
