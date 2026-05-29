// ============================================
// MagicWhisper — Local Meeting Notes Manager
// ============================================
// Stores live meeting transcripts and creates
// local extractive summaries, decisions, questions,
// and action items without requiring a cloud service.
// ============================================

const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const { logger } = require('./logger');

const DEFAULT_DB = { meetings: [] };
const MAX_MEETINGS = 500;
const MAX_SUMMARY_POINTS = 8;
const MAX_ACTION_ITEMS = 12;
const MAX_QUESTIONS = 10;
const MAX_DECISIONS = 10;

class MeetingNotesManager {
  constructor(filePath = path.join(app.getPath('userData'), 'meetings.json')) {
    this.filePath = filePath;
    this.data = DEFAULT_DB;
    this.load();
  }

  load() {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf8').replace(/^\uFEFF/, '');
        this.data = JSON.parse(raw);
        if (!Array.isArray(this.data.meetings)) this.data.meetings = [];
      } else {
        this.data = JSON.parse(JSON.stringify(DEFAULT_DB));
        this.save();
      }
    } catch (err) {
      logger.error('meeting-notes', 'Failed to load meetings database', { error: err.message });
      this.data = JSON.parse(JSON.stringify(DEFAULT_DB));
    }
  }

  save() {
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), 'utf8');
    } catch (err) {
      logger.error('meeting-notes', 'Failed to save meetings database', { error: err.message });
    }
  }

  createMeeting({ title, language, participantHints, model, source } = {}) {
    const now = new Date();
    const participants = normalizeParticipants(participantHints);
    const meeting = {
      id: `meeting-${now.getTime()}-${Math.random().toString(16).slice(2, 8)}`,
      title: sanitizeTitle(title) || `Meeting ${now.toLocaleString()}`,
      language: language || 'auto',
      model: model || '',
      source: source || 'microphone',
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      endedAt: null,
      durationMs: 0,
      status: 'recording',
      participants,
      speakerProfiles: [],
      segments: [],
      summary: emptySummary()
    };

    this.data.meetings.unshift(meeting);
    this.data.meetings = this.data.meetings.slice(0, MAX_MEETINGS);
    this.save();
    logger.info('meeting-notes', 'Meeting created', { id: meeting.id, title: meeting.title });
    return meeting;
  }

  getMeeting(id) {
    return this.data.meetings.find(m => m.id === id) || null;
  }

  listMeetings() {
    return this.data.meetings.map(m => ({
      id: m.id,
      title: m.title,
      createdAt: m.createdAt,
      updatedAt: m.updatedAt,
      endedAt: m.endedAt,
      durationMs: m.durationMs || 0,
      status: m.status,
      language: m.language,
      participants: m.participants || [],
      segmentCount: (m.segments || []).length,
      wordCount: countWords((m.segments || []).map(s => s.text).join(' ')),
      summaryPreview: m.summary?.overview || ''
    }));
  }

  renameMeeting(id, title) {
    const meeting = this.getMeeting(id);
    if (!meeting) return null;
    meeting.title = sanitizeTitle(title) || meeting.title;
    meeting.updatedAt = new Date().toISOString();
    this.save();
    return meeting;
  }

  deleteMeeting(id) {
    const before = this.data.meetings.length;
    this.data.meetings = this.data.meetings.filter(m => m.id !== id);
    const removed = this.data.meetings.length !== before;
    if (removed) this.save();
    return removed;
  }

  addSegment(id, { text, startedAt, endedAt, durationMs, fingerprint, chunkIndex } = {}) {
    const meeting = this.getMeeting(id);
    const cleanText = normalizeText(text);
    if (!meeting || !cleanText) return null;

    const speaker = this.identifySpeaker(meeting, cleanText, fingerprint);
    const segment = {
      id: `seg-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      chunkIndex: Number.isFinite(chunkIndex) ? chunkIndex : meeting.segments.length,
      speaker,
      text: cleanText,
      startedAt: startedAt || new Date().toISOString(),
      endedAt: endedAt || new Date().toISOString(),
      durationMs: durationMs || 0,
      confidence: speaker.confidence,
      fingerprint: fingerprint || null
    };

    meeting.segments.push(segment);
    meeting.durationMs = Math.max(meeting.durationMs || 0, sumDurations(meeting.segments));
    meeting.updatedAt = new Date().toISOString();
    meeting.summary = this.buildSummary(meeting);
    this.save();

    return { meeting: this.publicMeeting(meeting), segment };
  }

  finishMeeting(id) {
    const meeting = this.getMeeting(id);
    if (!meeting) return null;
    meeting.status = 'completed';
    meeting.endedAt = new Date().toISOString();
    meeting.durationMs = sumDurations(meeting.segments || []);
    meeting.updatedAt = meeting.endedAt;
    meeting.summary = this.buildSummary(meeting);
    this.save();
    logger.info('meeting-notes', 'Meeting finished', {
      id,
      segments: meeting.segments.length,
      words: countWords(meeting.segments.map(s => s.text).join(' '))
    });
    return this.publicMeeting(meeting);
  }

  publicMeeting(meeting) {
    if (!meeting) return null;
    return JSON.parse(JSON.stringify({
      ...meeting,
      speakerProfiles: undefined
    }));
  }

  identifySpeaker(meeting, text, fingerprint) {
    const explicit = detectExplicitSpeaker(text, meeting.participants || []);
    if (explicit) {
      return this.upsertSpeakerProfile(meeting, explicit, fingerprint, 0.96);
    }

    if (fingerprint && Array.isArray(meeting.speakerProfiles) && meeting.speakerProfiles.length > 0) {
      let best = null;
      for (const profile of meeting.speakerProfiles) {
        const dist = fingerprintDistance(profile.fingerprint, fingerprint);
        if (!best || dist < best.dist) best = { profile, dist };
      }
      if (best && best.dist <= 0.22) {
        updateProfileFingerprint(best.profile, fingerprint);
        return speakerFromProfile(best.profile, Math.max(0.5, 1 - best.dist));
      }
    }

    const index = (meeting.speakerProfiles || []).length + 1;
    const hintedName = (meeting.participants || [])[index - 1];
    const label = hintedName || `Speaker ${index}`;
    return this.upsertSpeakerProfile(meeting, label, fingerprint, hintedName ? 0.68 : 0.45);
  }

  upsertSpeakerProfile(meeting, label, fingerprint, confidence) {
    if (!Array.isArray(meeting.speakerProfiles)) meeting.speakerProfiles = [];
    const normalized = normalizeSpeakerLabel(label);
    let profile = meeting.speakerProfiles.find(p => p.label.toLowerCase() === normalized.toLowerCase());
    if (!profile) {
      profile = {
        id: `speaker-${meeting.speakerProfiles.length + 1}`,
        label: normalized,
        fingerprint: fingerprint || null,
        samples: fingerprint ? 1 : 0
      };
      meeting.speakerProfiles.push(profile);
    } else if (fingerprint) {
      updateProfileFingerprint(profile, fingerprint);
    }
    return speakerFromProfile(profile, confidence);
  }

  buildSummary(meeting) {
    const segments = meeting.segments || [];
    const transcript = segments.map(s => `${s.speaker?.label || 'Speaker'}: ${s.text}`).join('\n');
    const sentences = splitSentences(segments.map(s => s.text).join(' '));
    const topics = extractKeywords(sentences.join(' '), 10);
    const actionItems = extractByPatterns(sentences, ACTION_PATTERNS, MAX_ACTION_ITEMS);
    const decisions = extractByPatterns(sentences, DECISION_PATTERNS, MAX_DECISIONS);
    const questions = sentences.filter(s => /\?$/.test(s.trim())).slice(0, MAX_QUESTIONS);
    const keyPoints = rankSentences(sentences, topics).slice(0, MAX_SUMMARY_POINTS);

    return {
      generatedAt: new Date().toISOString(),
      overview: makeOverview(meeting, segments, topics),
      keyPoints,
      actionItems,
      decisions,
      questions,
      topics,
      transcriptWordCount: countWords(transcript),
      engine: 'local-extractive'
    };
  }
}

const ACTION_PATTERNS = [
  /\b(action item|todo|to-do|follow up|follow-up|next step|assign|owner|deadline|due|need to|needs to|will|please)\b/i,
  /\b(send|share|prepare|review|schedule|call|email|update|fix|build|create|confirm|check)\b/i
];

const DECISION_PATTERNS = [
  /\b(decided|decision|agreed|approved|confirmed|finalized|we will|we are going to|the plan is|let's go with|accepted)\b/i
];

function emptySummary() {
  return {
    generatedAt: null,
    overview: '',
    keyPoints: [],
    actionItems: [],
    decisions: [],
    questions: [],
    topics: [],
    transcriptWordCount: 0,
    engine: 'local-extractive'
  };
}

function sanitizeTitle(title) {
  return String(title || '').replace(/\s+/g, ' ').trim().slice(0, 120);
}

function normalizeText(text) {
  return String(text || '')
    .replace(/\[[^\]]+\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeParticipants(input) {
  const raw = Array.isArray(input) ? input.join(',') : String(input || '');
  return raw
    .split(/[,;\n]/)
    .map(s => normalizeSpeakerLabel(s))
    .filter(Boolean)
    .slice(0, 24);
}

function normalizeSpeakerLabel(label) {
  return String(label || '')
    .replace(/[^a-zA-Z0-9 ._\-']/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 48);
}

function detectExplicitSpeaker(text, participants) {
  const colon = text.match(/^([A-Z][a-zA-Z.'-]+(?:\s+[A-Z][a-zA-Z.'-]+){0,2})\s*:/);
  if (colon) return colon[1];

  const intro = text.match(/\b(?:this is|i am|i'm|my name is)\s+([A-Z][a-zA-Z.'-]+(?:\s+[A-Z][a-zA-Z.'-]+){0,2})\b/);
  if (intro) return intro[1];

  for (const participant of participants || []) {
    const escaped = participant.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const ownCue = new RegExp(`\\b(?:this is|i am|i'm|my name is)\\s+${escaped}\\b`, 'i');
    if (ownCue.test(text)) return participant;
  }
  return null;
}

function speakerFromProfile(profile, confidence) {
  return {
    id: profile.id,
    label: profile.label,
    confidence: Number(confidence.toFixed(2))
  };
}

function updateProfileFingerprint(profile, fingerprint) {
  if (!fingerprint) return;
  if (!profile.fingerprint) {
    profile.fingerprint = fingerprint;
    profile.samples = 1;
    return;
  }
  const samples = Math.max(1, profile.samples || 1);
  const weight = Math.min(0.28, 1 / (samples + 1));
  for (const key of ['rms', 'zcr', 'centroid', 'flatness']) {
    const current = Number(profile.fingerprint[key] || 0);
    const next = Number(fingerprint[key] || 0);
    profile.fingerprint[key] = current * (1 - weight) + next * weight;
  }
  profile.samples = samples + 1;
}

function fingerprintDistance(a, b) {
  if (!a || !b) return 1;
  const rms = Math.abs((a.rms || 0) - (b.rms || 0)) * 2.2;
  const zcr = Math.abs((a.zcr || 0) - (b.zcr || 0)) * 3.0;
  const centroid = Math.abs((a.centroid || 0) - (b.centroid || 0)) * 1.4;
  const flatness = Math.abs((a.flatness || 0) - (b.flatness || 0)) * 1.2;
  return Math.min(1, rms + zcr + centroid + flatness);
}

function splitSentences(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+|(?:\s+-\s+)/)
    .map(s => s.trim())
    .filter(s => countWords(s) >= 4)
    .slice(0, 300);
}

function extractByPatterns(sentences, patterns, limit) {
  const seen = new Set();
  const matches = [];
  for (const sentence of sentences) {
    if (!patterns.some(p => p.test(sentence))) continue;
    const key = sentence.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    matches.push(sentence);
    if (matches.length >= limit) break;
  }
  return matches;
}

function extractKeywords(text, limit) {
  const stop = new Set([
    'the', 'and', 'for', 'that', 'this', 'with', 'from', 'you', 'your', 'are', 'was', 'were',
    'will', 'have', 'has', 'had', 'but', 'not', 'our', 'can', 'about', 'into', 'then', 'than',
    'there', 'their', 'they', 'them', 'what', 'when', 'where', 'which', 'also', 'just', 'like',
    'we', 'to', 'of', 'in', 'on', 'a', 'an', 'is', 'it', 'as', 'be', 'by', 'or', 'at', 'if'
  ]);
  const counts = new Map();
  String(text || '').toLowerCase().replace(/[a-z0-9][a-z0-9'-]{2,}/g, word => {
    if (!stop.has(word)) counts.set(word, (counts.get(word) || 0) + 1);
    return word;
  });
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([word]) => word);
}

function rankSentences(sentences, topics) {
  const topicSet = new Set(topics);
  return [...sentences]
    .map((sentence, index) => {
      const words = sentence.toLowerCase().match(/[a-z0-9][a-z0-9'-]{2,}/g) || [];
      const topicHits = words.filter(w => topicSet.has(w)).length;
      const actionBoost = ACTION_PATTERNS.some(p => p.test(sentence)) ? 1.5 : 0;
      const decisionBoost = DECISION_PATTERNS.some(p => p.test(sentence)) ? 1.5 : 0;
      const lengthScore = Math.min(2, words.length / 18);
      const earlyBoost = index < 8 ? 0.4 : 0;
      return { sentence, score: topicHits + actionBoost + decisionBoost + lengthScore + earlyBoost };
    })
    .sort((a, b) => b.score - a.score)
    .map(item => item.sentence);
}

function makeOverview(meeting, segments, topics) {
  const duration = formatDuration(sumDurations(segments));
  const speakerCount = new Set(segments.map(s => s.speaker?.label).filter(Boolean)).size;
  const topicText = topics.slice(0, 5).join(', ');
  if (!segments.length) return 'No meeting audio has been transcribed yet.';
  return `${meeting.title} captured ${segments.length} live transcript segment${segments.length === 1 ? '' : 's'} over ${duration}. ${speakerCount || 1} speaker${speakerCount === 1 ? '' : 's'} detected${topicText ? `, with focus on ${topicText}` : ''}.`;
}

function sumDurations(segments) {
  return (segments || []).reduce((total, segment) => total + (segment.durationMs || 0), 0);
}

function countWords(text) {
  return String(text || '').trim().split(/\s+/).filter(Boolean).length;
}

function formatDuration(ms) {
  const seconds = Math.max(0, Math.round((ms || 0) / 1000));
  const minutes = Math.floor(seconds / 60);
  const rem = seconds % 60;
  if (minutes <= 0) return `${rem}s`;
  return `${minutes}m ${rem}s`;
}

module.exports = { MeetingNotesManager };
