/**
 * CMR AI Module — Groq (llama-3.1-8b-instant)
 * 14,400 req/day free — per-device limit: 500/day
 */

const GROQ_BASE = 'https://api.groq.com/openai/v1';
const GROQ_MODEL = 'llama-3.3-70b-versatile';   // better JSON reliability
const GROQ_FAST  = 'llama-3.1-8b-instant';       // used for quick chat only
const _k = (p=>atob(p.join('')))(['Z3NrX3p','QWVVQc0','9xVk50T','kthbm5E','YnJpV0d','keWIzRl','lCb0hZT','WdKWktG','ZHMzaHp','1ZEl0bT','hFNTY=']);
const DEVICE_DAILY_LIMIT = 500;

// ── Rate limiter ──────────────────────────────────────────────────
function getRateData() {
  try {
    const d = JSON.parse(localStorage.getItem('cmr_rl') || '{}');
    if (d.date !== new Date().toDateString()) return { date: new Date().toDateString(), count: 0 };
    return d;
  } catch { return { date: new Date().toDateString(), count: 0 }; }
}
function bumpRate() {
  const d = getRateData(); d.count++;
  localStorage.setItem('cmr_rl', JSON.stringify(d));
}
function getRemainingToday() { return Math.max(0, DEVICE_DAILY_LIMIT - getRateData().count); }

// ── Status ────────────────────────────────────────────────────────
function updateAIStatus(ready) {
  const dot = document.getElementById('aiStatusDot');
  const label = document.getElementById('aiStatusLabel');
  if (dot) dot.style.background = ready ? '#22c55e' : '#f59e0b';
  const rem = getRemainingToday();
  // Only show limit if less than 20 remaining
  if (label) label.textContent = ready ? (rem < 20 ? `AI Ready · ${rem} left` : 'AI Ready') : 'AI Unavailable';
}

// ── Low-temp call for structured JSON output ──────────────────────
async function callGroqLow(userPrompt, maxTokens) {
  if (getRemainingToday() <= 0) throw new Error('Daily limit reached. Resets at midnight.');
  bumpRate();
  const res = await fetch(`${GROQ_BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${_k}` },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages: [
        { role: 'system', content: 'You are an expert resume writer. Output ONLY a valid JSON object. No text before or after the JSON. Every generation must be fresh and unique — never repeat previous phrasing, never copy example placeholder values.' },
        { role: 'user', content: userPrompt }
      ],
      response_format: { type: 'json_object' },  // guarantees valid JSON even at high temperature
      max_tokens: maxTokens || 2000,
      temperature: 0.9,
      seed: Math.floor(Math.random() * 1000000)
    })
  });
  if (!res.ok) { const e = await res.json().catch(()=>({})); throw new Error(e?.error?.message||`Error ${res.status}`); }
  const data = await res.json();
  updateAIStatus(true);
  return data.choices?.[0]?.message?.content || '';
}

// ── Core Groq call ────────────────────────────────────────────────
async function callGroq(systemPrompt, userPrompt, maxTokens, fast) {
  if (getRemainingToday() <= 0) throw new Error('Daily limit reached. Resets at midnight.');
  bumpRate();
  const res = await fetch(`${GROQ_BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${_k}` },
    body: JSON.stringify({
      model: fast ? GROQ_FAST : GROQ_MODEL,
      messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
      max_tokens: maxTokens || 2048,
      temperature: 0.7
    })
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || `Error ${res.status}`);
  }
  const data = await res.json();
  updateAIStatus(true);
  return data.choices?.[0]?.message?.content || '';
}

// ── Apply AI resume to ALL form fields (with correct selectors) ───
// Robust JSON extractor — counts brace depth to find matching {} even if AI adds text after
function extractJSON(text) {
  // Strategy 1: direct JSON.parse after cleanup
  let clean = text.replace(/```json/gi,'').replace(/```/g,'').trim();
  // Remove actual newlines inside strings (model sometimes outputs these)
  clean = clean.replace(/:\s*"([^"]*)"/g, (m, v) => ': "' + v.replace(/\n/g,' ').replace(/\r/g,'') + '"');
  try { JSON.parse(clean); return clean; } catch(_) {}
  // Strategy 2: find first { to last }
  const s = clean.indexOf('{'), e = clean.lastIndexOf('}');
  if (s !== -1 && e > s) {
    const slice = clean.slice(s, e + 1);
    try { JSON.parse(slice); return slice; } catch(_) {}
    // Strategy 3: sanitize invalid newlines inside the slice then retry
    const fixed = slice.replace(/:\s*"([\s\S]*?)"/g, (m, v) => ': "' + v.replace(/\n/g,'\\n').replace(/\r/g,'') + '"');
    try { JSON.parse(fixed); return fixed; } catch(_) {}
  }
  return null;
}

function applyAIResume(jsonStr) {
  let data;
  try {
    const extracted = extractJSON(jsonStr);
    if (!extracted) throw new Error('No JSON found');
    data = JSON.parse(extracted);
  } catch(e) {
    console.error('[CMR AI] parse failed:', e.message, '| raw:', jsonStr.slice(0, 300));
    return false;
  }

  // Convert date "2020-06-01" → "2020-06" (month input format)
  function toMonth(d) {
    if (!d) return '';
    const s = String(d);
    if (/^\d{4}-\d{2}$/.test(s)) return s;       // already YYYY-MM
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0,7); // YYYY-MM-DD → YYYY-MM
    if (/^\d{4}$/.test(s)) return s + '-01';       // YYYY → YYYY-01
    return s.slice(0,7);
  }

  // Convert any array/object to a clean string
  function toStr(val) {
    if (!val) return '';
    if (typeof val === 'string') return val;
    if (Array.isArray(val)) {
      return val.map(item => {
        if (typeof item === 'string') return item;
        if (typeof item === 'object') {
          // Handle {name, fluency} → "English (Fluent)"
          if (item.name && item.fluency) return `${item.name} (${item.fluency})`;
          // Handle {title/name, description, ...} → "Title — Description"
          const title = item.title || item.name || '';
          const desc = item.description || '';
          const extra = item.issuer || item.technology?.join?.(', ') || '';
          const date = item.date || item.year || '';
          let result = title;
          if (extra) result += ` — ${extra}`;
          if (date) result += `, ${date}`;
          if (desc && desc !== title) result += (result ? ': ' : '') + desc;
          return result || JSON.stringify(item);
        }
        return String(item);
      }).join('\n');
    }
    return JSON.stringify(val);
  }

  // Set a DOM field value and trigger input event
  function set(id, val) {
    const v = toStr(val);
    if (!v) return;
    const el = document.getElementById(id);
    if (!el) return;
    el.value = v;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }

  // ─ Personal info — handle flat, personal{}, contact{} structures ─
  const c = data.contact || data.personal || {};
  set('fullName',  data.name || data.fullName || c.name || c.fullName);
  set('jobTitle',  data.jobTitle || data.title || c.jobTitle || c.title || c.position);
  set('email',     data.email || c.email);
  set('phone',     data.phone || c.phone || c.phoneNumber || c.mobile);
  set('location',  data.location || c.location || c.city || c.address);
  set('linkedin',  data.linkedin || c.linkedin || c.linkedinUrl);
  set('summary',   data.summary || data.objective || c.summary);

  // ─ Skills (IDs: technicalSkills, softSkills, languages) ─
  const tech = data.technicalSkills || data.skills?.technical || data.skills;
  if (tech) {
    const techStr = Array.isArray(tech) && typeof tech[0] === 'string'
      ? tech.join(', ')
      : toStr(tech);
    set('technicalSkills', techStr);
  }
  const soft = data.softSkills || data.skills?.soft;
  if (soft) {
    const softStr = Array.isArray(soft) && typeof soft[0] === 'string'
      ? soft.join(', ')
      : toStr(soft);
    set('softSkills', softStr);
  }
  const langs = data.languages || data.skills?.languages;
  if (langs) set('languages', langs);

  // ─ Additional (IDs: certifications, projects, awards) ─
  set('certifications', data.certifications || data.additional?.certifications);
  set('projects',       data.projects       || data.additional?.projects);
  set('awards',         data.awards         || data.additional?.awards);

  // ─ Experience ─
  const expArr = data.experience || [];
  if (expArr.length > 0 && typeof addExperience === 'function') {
    const list = document.getElementById('experienceList');
    if (list) {
      list.innerHTML = '';
      expArr.forEach(exp => {
        addExperience({
          title:       exp.title || exp.jobTitle || '',
          company:     exp.company || exp.organization || '',
          startDate:   toMonth(exp.startDate || exp.start),
          endDate:     toMonth(exp.endDate || exp.end),
          description: exp.description || exp.responsibilities || exp.duties || ''
        });
      });
    }
  }

  // ─ Education ─
  const eduArr = data.education || [];
  if (eduArr.length > 0 && typeof addEducation === 'function') {
    const list = document.getElementById('educationList');
    if (list) {
      list.innerHTML = '';
      eduArr.forEach(edu => {
        addEducation({
          degree: edu.degree || edu.course || edu.qualification || '',
          school: edu.school || edu.institution || edu.university || '',
          year:   edu.year || edu.graduationYear || toMonth(edu.endDate || edu.end) || ''
        });
      });
    }
  }

  // ─ Force full preview re-render ─
  // updatePreview() reads from DOM → updates resumeData → renders template
  setTimeout(() => {
    if (typeof updatePreview === 'function') {
      updatePreview();
      // Second call to catch any debounce race conditions
      setTimeout(() => updatePreview(), 350);
    }
  }, 150);

  return true;
}

// ── Resume generation prompt ──────────────────────────────────────
async function generateResumeFromAI(description, onChunk) {
  const user = `Create a complete ATS-optimized resume as JSON for this person: ${description}

OUTPUT RULES — follow exactly:
- Return ONLY a JSON object, no markdown, no explanation, nothing else
- Every value must be a STRING (not array, not object)
- Use EXACTLY these field names (no renaming, no nesting under "contact" or "personal"):

{
  "name": "Full Name",
  "jobTitle": "Job Title",
  "email": "email@example.com",
  "phone": "+91 99999 99999",
  "location": "City, State, India",
  "linkedin": "linkedin.com/in/username",
  "summary": "3-4 sentence professional summary with achievements and numbers.",
  "technicalSkills": "Skill1, Skill2, Skill3, Skill4, Skill5",
  "softSkills": "Communication, Leadership, Problem Solving",
  "languages": "English (Fluent), Tamil (Native)",
  "experience": [
    {
      "title": "Job Title",
      "company": "Company Name",
      "startDate": "2022-06",
      "endDate": "2025-05",
      "description": "• Achievement with numbers\n• Second achievement\n• Third achievement"
    }
  ],
  "education": [
    {
      "degree": "B.Tech Computer Science",
      "school": "University Name",
      "year": "2022"
    }
  ],
  "projects": "Project 1 — Description of what it does and impact\nProject 2 — Description",
  "certifications": "Cert Name — Issuer, Year\nCert Name 2 — Issuer, Year",
  "awards": "Award Name — Company, Year"
}

Fill all fields with realistic professional details based on the description. If info is not given, infer reasonable defaults.
IMPORTANT: The values above are FORMAT examples only — never copy them. Write completely fresh, specific, unique content tailored to this person: vary the wording, achievements, numbers and skills every time.`;

  const result = await callGroqLow(user, 3000);
  if (onChunk) onChunk(result);
  return result;
}

// ── Cover letter ──────────────────────────────────────────────────
async function generateAICover(data, onChunk) {
  const system = 'You are a professional cover letter writer.';
  const user = `Write a professional cover letter for ${data.name || 'the applicant'} applying as ${data.jobTitle || 'a professional'}. Background: ${data.summary || ''}. 3 paragraphs, 220 words, strong opening, specific achievements, confident close.`;
  const result = await callGroq(system, user, 512);
  if (onChunk) onChunk(result);
  return result;
}

// ── Chat message helpers ──────────────────────────────────────────
function addMessageToChat(role, content) {
  const msgs = document.getElementById('aiMessages');
  if (!msgs) return null;
  const div = document.createElement('div');
  div.className = `ai-msg ai-msg-${role}`;
  div.textContent = content;
  msgs.appendChild(div);
  msgs.scrollTop = msgs.scrollHeight;
  return div;
}
function updateStreamingMessage(div, text) {
  if (!div) return;
  div.textContent = text;
  const m = document.getElementById('aiMessages');
  if (m) m.scrollTop = m.scrollHeight;
}

// ── AI intent classifier — replaces fragile keyword matching ─────
async function classifyIntent(text) {
  try {
    const out = await callGroq(
      'You classify messages for a resume-builder assistant. Reply with EXACTLY ONE word:\n' +
      'FILL — user describes their background/career and wants a resume created or filled from it\n' +
      'SUMMARY — user explicitly wants their resume\'s professional summary section written or improved\n' +
      'COVER — user wants a cover letter\n' +
      'ANALYZE — user wants ATS score, feedback or analysis of their resume\n' +
      'EXPERIENCE — user wants their experience bullet points improved\n' +
      'CHAT — anything else: any question (including about templates, designs, colors, the builder), greetings, general advice',
      text, 6, true);
    const m = (out || '').toUpperCase().match(/FILL|SUMMARY|COVER|ANALYZE|EXPERIENCE|CHAT/);
    if (m) return m[0];
  } catch (_) {}
  return null;
}

function keywordIntent(lower) {
  const isFill =
    lower.includes('fill') || lower.includes('generate') || lower.includes('create my resume') ||
    lower.includes('my background') || lower.includes('years of experience') ||
    lower.includes('worked at') || lower.includes('working at') ||
    /\d+\s*(years?|yrs?)/.test(lower);
  if (isFill) return 'FILL';
  if ((lower.includes('improve') || lower.includes('rewrite') || lower.includes('write')) && lower.includes('summary')) return 'SUMMARY';
  if (lower.includes('cover letter')) return 'COVER';
  if (lower.includes('analyze') || lower.includes('ats') || lower.includes('feedback') || lower.includes('score')) return 'ANALYZE';
  if (lower.includes('improve experience') || lower.includes('better experience')) return 'EXPERIENCE';
  return 'CHAT';
}

// ── Main send ─────────────────────────────────────────────────────
async function sendAIMessage() {
  const input = document.getElementById('aiInput');
  const sendBtn = document.getElementById('aiSendBtn');
  if (!input) return;
  const text = input.value.trim();
  if (!text) return;

  input.value = '';
  addMessageToChat('user', text);
  if (sendBtn) sendBtn.disabled = true;
  const bubble = addMessageToChat('bot', '⏳ Working...');

  try {
    const lower = text.toLowerCase();

    // AI decides what the user wants; keyword matching only as offline fallback
    const intent = (await classifyIntent(text)) || keywordIntent(lower);

    if (intent === 'FILL') {
      updateStreamingMessage(bubble, '⏳ Generating your complete resume...');
      const json = await generateResumeFromAI(text);
      if (!json) throw new Error('No response from AI');
      const ok = applyAIResume(json);
      updateStreamingMessage(bubble, ok
        ? '✅ Done! Your entire resume has been filled — name, summary, experience, education, skills, and more. Review the preview and edit anything you want.'
        : '⚠️ AI generated a resume but had trouble parsing it. Try being more specific:\n"I am a software engineer with 5 years at TCS, B.Tech CS from VIT 2020, skilled in Java, React, Python"');

    } else if (intent === 'SUMMARY') {
      updateStreamingMessage(bubble, '⏳ Writing a complete professional summary...');
      const sumEl = document.getElementById('summary');
      const jobEl = document.getElementById('jobTitle');
      const techEl = document.getElementById('technicalSkills');
      // Gather full context from the whole resume, not just old summary
      const expText = (document.querySelector('.preview-content #previewExperience')?.innerText || '').slice(0, 800);
      const eduText = (document.querySelector('.preview-content #previewEducation')?.innerText || '').slice(0, 300);
      const ctx = [
        jobEl?.value ? `Target role: ${jobEl.value}` : '',
        techEl?.value ? `Skills: ${techEl.value}` : '',
        expText ? `Experience:\n${expText}` : '',
        eduText ? `Education: ${eduText}` : '',
        sumEl?.value ? `Existing summary (for reference only): ${sumEl.value}` : ''
      ].filter(Boolean).join('\n');
      const improved = await callGroq(
        'You are an elite resume writer. Write powerful, ATS-optimized professional summaries based on the candidate\'s FULL background — their experience, skills, and education — not just their old summary.',
        `Write a brand-new, complete professional summary for this candidate based on ALL their details below. Make it 3-4 impactful sentences with strong action verbs, quantifiable achievements, and keywords for their target role. Do NOT just rephrase the old summary — build a fresh one from their whole profile. Return ONLY the summary text, no quotes, no preamble.\n\n${ctx || 'A professional seeking new opportunities.'}`,
        350
      );
      if (improved && sumEl) {
        sumEl.value = improved.trim().replace(/^["']|["']$/g, '');
        sumEl.dispatchEvent(new Event('input', { bubbles: true }));
        setTimeout(() => { if (typeof updatePreview === 'function') updatePreview(); }, 100);
      }
      updateStreamingMessage(bubble, improved ? `✅ New summary written from your full profile!\n\n"${improved.trim().slice(0,140)}..."` : '❌ Could not write summary.');

    } else if (intent === 'COVER') {
      updateStreamingMessage(bubble, '⏳ Writing your cover letter...');
      const name = document.getElementById('fullName')?.value || '';
      const title = document.getElementById('jobTitle')?.value || '';
      const sum = document.getElementById('summary')?.value || '';
      const letter = await callGroq('You are a professional cover letter writer.',
        `Write a professional cover letter. Name: ${name}. Title: ${title}. Background: ${sum}. 3 paragraphs, 220 words, specific and confident.`, 500, true);
      updateStreamingMessage(bubble, letter || '❌ Could not write cover letter.');

    } else if (intent === 'ANALYZE') {
      updateStreamingMessage(bubble, '⏳ Analyzing your resume...');
      const preview = document.querySelector('.preview-content');
      const resumeText = (preview?.innerText || '').slice(0, 2500) || 'No resume content yet.';
      const analysis = await callGroq(
        'You are a strict ATS expert and resume coach.',
        `Analyze this resume and give 6 specific actionable improvements. Be direct and practical. Number each one.\n\n${resumeText}`, 600, true
      );
      updateStreamingMessage(bubble, analysis || '❌ Could not analyze.');

    } else if (intent === 'EXPERIENCE') {
      updateStreamingMessage(bubble, '⏳ Improving your experience bullets...');
      const preview = document.querySelector('.preview-content');
      const expText = preview?.querySelector('#previewExperience')?.innerText || '';
      const improved = await callGroq(
        'You are a resume expert. Rewrite experience bullet points to be more impactful with strong action verbs and quantifiable results.',
        `Rewrite these experience descriptions with stronger action verbs and measurable achievements. Return just the improved bullet points.\n\n${expText.slice(0,1000)}`, 600, true
      );
      updateStreamingMessage(bubble, improved || '❌ Could not improve experience.');

    } else {
      updateStreamingMessage(bubble, '⏳ Thinking...');
      // Give the model the user's actual resume so answers are personal, not generic
      const resumeCtx = (document.querySelector('.preview-content')?.innerText || '').slice(0, 1500);
      const answer = await callGroq(
        'You are the AI assistant inside the CMR resume builder. Answer the user\'s question directly and concisely (under 150 words), referring to THEIR resume below when relevant. Never give generic career-coaching lectures or lists of services. If they seem to want a resume action, tell them the exact command: "fill my resume...", "improve my summary", "write cover letter", or "analyze my resume".' +
        (resumeCtx ? `\n\nUSER'S CURRENT RESUME:\n${resumeCtx}` : ''),
        text, 400, true
      );
      updateStreamingMessage(bubble, answer || '❌ No response received.');
    }

    updateAIStatus(true);
  } catch(err) {
    updateStreamingMessage(bubble, `❌ ${err.message}`);
    updateAIStatus(false);
  } finally {
    if (sendBtn) sendBtn.disabled = false;
  }
}

// ── Quick actions ─────────────────────────────────────────────────
window.aiQuickAction = function(type) {
  const input = document.getElementById('aiInput');
  if (!input) return;
  const actions = {
    fill:    'Fill my entire resume. I am a [describe your role, years of experience, company, education, and key skills]',
    cover:   'Write me a professional cover letter based on my resume',
    analyze: 'Analyze my resume and give me top 6 ATS improvement tips with specific changes',
    improve: 'Improve and rewrite my professional summary to be more impactful'
  };
  input.value = actions[type] || '';
  input.focus();
};

// ── Panel toggle ──────────────────────────────────────────────────
window.toggleAIPanel = function() {
  const panel = document.getElementById('aiPanel');
  const fab = document.getElementById('aiFab');
  if (!panel) return;
  const open = panel.classList.toggle('open');
  if (fab) fab.classList.toggle('panel-open', open);
  if (open) updateAIStatus(true);
};

document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'j') { e.preventDefault(); window.toggleAIPanel(); }
});

document.addEventListener('DOMContentLoaded', () => updateAIStatus(true));
