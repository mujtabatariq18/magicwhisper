// ============================================
// MagicWhisper — Word Count Challenges & Stats
// ============================================
// Gamification system with daily word goals,
// streak tracking, milestones, and achievements.
// ============================================

const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const { logger } = require('./logger');

const MILESTONES = [
  { words: 100, label: '100 words', message: 'First Century! You\u2019ve dictated 100 words 🎉' },
  { words: 500, label: '500 words', message: 'Five Hundred! Half a thousand words 🔥' },
  { words: 1000, label: '1K words', message: 'One Thousand! You\u2019re on fire 🚀' },
  { words: 5000, label: '5K words', message: 'Five Thousand! A true voice warrior 💪' },
  { words: 10000, label: '10K words', message: 'Ten Thousand! Legendary 🏆' },
  { words: 25000, label: '25K words', message: 'Twenty-Five K! Unstoppable 👑' },
  { words: 50000, label: '50K words', message: 'Fifty Thousand! Hall of Fame 🌟' },
  { words: 100000, label: '100K words', message: 'One Hundred Thousand! Voice Master 🎓' }
];

const STREAK_MILESTONES = [
  { days: 3, label: '3 days', message: '3-day streak! Keep going 🔥' },
  { days: 7, label: '1 week', message: 'One week streak! Incredible 🎯' },
  { days: 14, label: '2 weeks', message: 'Two week streak! Dedication 💎' },
  { days: 30, label: '1 month', message: 'One month streak! Legendary 🏅' },
  { days: 60, label: '2 months', message: 'Two month streak! Amazing 🌟' },
  { days: 100, label: '100 days', message: '100 day streak! Truly elite 👑' },
  { days: 365, label: '1 year', message: 'One year streak! Hall of Fame 🏆' }
];

class ChallengesManager {
  constructor() {
    this.dbPath = path.join(app.getPath('userData'), 'challenges.json');
    this.data = {
      dailyGoal: 100,          // Words per day target
      totalWords: 0,
      dailyLog: {},            // { '2026-04-15': { words: 250, sessions: 5 } }
      achievedMilestones: [],  // IDs of achieved milestones
      achievedStreaks: [],     // IDs of achieved streak milestones
      longestStreak: 0
    };
    this.load();
  }

  load() {
    try {
      if (fs.existsSync(this.dbPath)) {
        const raw = fs.readFileSync(this.dbPath, 'utf-8');
        this.data = { ...this.data, ...JSON.parse(raw) };
        logger.debug('challenges', 'Challenges data loaded', {
          totalWords: this.data.totalWords,
          dailyGoal: this.data.dailyGoal
        });
      }
    } catch (e) {
      logger.error('challenges', 'Failed to load challenges data', { error: e.message });
    }
  }

  save() {
    try {
      const dir = path.dirname(this.dbPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this.dbPath, JSON.stringify(this.data, null, 2), 'utf-8');
    } catch (e) {
      logger.error('challenges', 'Failed to save challenges data', { error: e.message });
    }
  }

  /**
   * Record words from a transcription.
   * @param {number} wordCount - Number of words transcribed
   * @returns {object|null} Achievement notification if a milestone was hit
   */
  recordWords(wordCount) {
    if (wordCount <= 0) return null;

    const today = new Date().toISOString().slice(0, 10);

    // Update daily log
    if (!this.data.dailyLog[today]) {
      this.data.dailyLog[today] = { words: 0, sessions: 0 };
    }
    this.data.dailyLog[today].words += wordCount;
    this.data.dailyLog[today].sessions += 1;

    // Update total
    const prevTotal = this.data.totalWords;
    this.data.totalWords += wordCount;

    // Check milestones
    let notification = null;
    for (const milestone of MILESTONES) {
      if (prevTotal < milestone.words && this.data.totalWords >= milestone.words) {
        if (!this.data.achievedMilestones.includes(milestone.words)) {
          this.data.achievedMilestones.push(milestone.words);
          notification = {
            type: 'milestone',
            title: milestone.label,
            message: milestone.message,
            totalWords: this.data.totalWords
          };
          logger.info('challenges', `Milestone achieved: ${milestone.label}`);
        }
      }
    }

    // Check daily goal completion
    if (!notification && this.data.dailyLog[today].words >= this.data.dailyGoal) {
      const previousWords = this.data.dailyLog[today].words - wordCount;
      if (previousWords < this.data.dailyGoal) {
        notification = {
          type: 'daily_goal',
          title: 'Daily Goal Complete!',
          message: `You\u2019ve hit ${this.data.dailyGoal} words today! 🎉`,
          todayWords: this.data.dailyLog[today].words
        };
        logger.info('challenges', `Daily goal achieved: ${this.data.dailyGoal} words`);
      }
    }

    // Check streak milestones
    const streak = this.calculateStreak();
    if (streak > this.data.longestStreak) {
      this.data.longestStreak = streak;
    }

    if (!notification) {
      for (const sm of STREAK_MILESTONES) {
        if (streak >= sm.days && !this.data.achievedStreaks.includes(sm.days)) {
          this.data.achievedStreaks.push(sm.days);
          notification = {
            type: 'streak',
            title: `${sm.label} streak!`,
            message: sm.message,
            streak
          };
          logger.info('challenges', `Streak milestone: ${sm.label}`);
        }
      }
    }

    // Clean old daily logs (keep last 90 days)
    this._cleanOldLogs();

    this.save();
    return notification;
  }

  /**
   * Calculate current streak.
   */
  calculateStreak() {
    const days = Object.keys(this.data.dailyLog).sort().reverse();
    if (days.length === 0) return 0;

    const today = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

    // Must have activity today or yesterday to have a streak
    if (days[0] !== today && days[0] !== yesterday) return 0;

    let streak = 0;
    let checkDate = new Date(days[0]);

    for (const day of days) {
      const dayDate = new Date(day);
      const expectedDate = new Date(checkDate - streak * 86400000);

      // Allow 1-day gap tolerance for timezone issues
      const diffDays = Math.round((checkDate.getTime() - dayDate.getTime()) / 86400000);

      if (diffDays === streak) {
        streak++;
      } else if (diffDays > streak) {
        break;
      }
    }

    return streak;
  }

  /**
   * Get today's progress.
   */
  getTodayProgress() {
    const today = new Date().toISOString().slice(0, 10);
    const todayData = this.data.dailyLog[today] || { words: 0, sessions: 0 };
    const goal = this.data.dailyGoal;

    return {
      words: todayData.words,
      sessions: todayData.sessions,
      goal,
      progress: Math.min(100, Math.round((todayData.words / goal) * 100)),
      completed: todayData.words >= goal
    };
  }

  /**
   * Get weekly summary.
   */
  getWeeklySummary() {
    const days = [];
    for (let i = 6; i >= 0; i--) {
      const date = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
      const dayData = this.data.dailyLog[date] || { words: 0, sessions: 0 };
      const dayName = new Date(date).toLocaleDateString('en-US', { weekday: 'short' });
      days.push({
        date,
        dayName,
        words: dayData.words,
        sessions: dayData.sessions,
        metGoal: dayData.words >= this.data.dailyGoal
      });
    }
    return days;
  }

  /**
   * Get full stats.
   */
  getStats() {
    const streak = this.calculateStreak();
    const todayProgress = this.getTodayProgress();
    const weekly = this.getWeeklySummary();
    const weeklyTotal = weekly.reduce((sum, d) => sum + d.words, 0);

    return {
      totalWords: this.data.totalWords,
      dailyGoal: this.data.dailyGoal,
      streak,
      longestStreak: this.data.longestStreak,
      todayProgress,
      weeklyTotal,
      weeklySummary: weekly,
      achievedMilestones: this.data.achievedMilestones,
      nextMilestone: MILESTONES.find(m => m.words > this.data.totalWords) || null
    };
  }

  /**
   * Set daily word goal.
   */
  setDailyGoal(words) {
    this.data.dailyGoal = Math.max(10, Math.min(10000, words));
    this.save();
    logger.info('challenges', `Daily goal set to ${this.data.dailyGoal}`);
  }

  _cleanOldLogs() {
    const cutoff = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
    const keys = Object.keys(this.data.dailyLog);
    for (const key of keys) {
      if (key < cutoff) delete this.data.dailyLog[key];
    }
  }
}

module.exports = { ChallengesManager, MILESTONES, STREAK_MILESTONES };
