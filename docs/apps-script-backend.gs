/**
 * Yoobee Connect — Google Apps Script backend
 * Endpoints:
 *   GET  ?action=ping
 *   GET  ?action=restore&code=ABC123
 *   GET  ?action=matches&code=ABC123
 *   GET  ?action=candidates&code=ABC123
 *   POST {action:'register', name, campus, country, background, interests, teams}
 *   POST {action:'swipe', code, target, dir:'left'|'right'}
 */

var SHEET_NAMES = {
  PROFILES: 'profiles',
  SWIPES:   'swipes',
  MATCHES:  'matches'
};

var DEFAULT_HEADERS = {
  profiles: ['timestamp','code','name','campus','country','background','interests','teams','photo'],
  swipes:   ['timestamp','swiper','target','dir'],
  matches:  ['timestamp','code_a','code_b']
};

var PROFILE_ALIASES = {
  code:      ['code','join_code','joincode','profile_code','id'],
  name:      ['name','full_name','fullname','display_name','displayname'],
  campus:    ['campus','campus_name','campusname','location'],
  country:   ['country','country_name','countryname','nation'],
  background:['background','programme','program','study','major','course'],
  interests: ['interests','interest','tags','skills'],
  teams:     ['teams','contact','email','handle','reachout'],
  photo:     ['photo','profilephoto','picture','avatar','image','photodata','photo_data','photourl'],
  timestamp: ['timestamp','ts','created','created_at','createdat','submitted']
};

var SWIPE_ALIASES = {
  swiper:    ['swiper','code','from','source','source_code'],
  target:    ['target','candidate','to','destination','target_code'],
  dir:       ['dir','direction','choice','decision','swipe'],
  timestamp: ['timestamp','ts','created','created_at','createdat']
};

var MATCH_ALIASES = {
  codeA:     ['code_a','codea','user_a','usera','initiator','source','from'],
  codeB:     ['code_b','codeb','user_b','userb','partner','target','to'],
  timestamp: ['timestamp','ts','matched_at','matchedat','created','created_at','createdat','time']
};

var MS_PER_DAY  = 24 * 60 * 60 * 1000;
var EXCEL_EPOCH = new Date('1899-12-30T00:00:00Z').getTime();

/* ==========================
   HTTP ENTRYPOINTS
========================== */
function doGet(e){
  try{
    var p = e && e.parameter ? e.parameter : {};
    var action = (p.action || '').toLowerCase();
    var out;
    switch(action){
      case 'ping':
        out = { ok:true, version:'yc-2025-10-17' };
        break;
      case 'restore':
        out = handleRestore(p);
        break;
      case 'matches':
        out = handleMatches(p);
        break;
      case 'candidates':
        out = handleCandidates(p);
        break;
      default:
        out = createError('Unsupported action: ' + action);
    }
    return respondJson(out);
  }catch(err){
    return respondJson(createError(err));
  }
}

function doPost(e){
  try{
    var body = parseBody(e);           // front-end sends text/plain JSON
    var action = (body.action || '').toLowerCase();
    var out;
    switch(action){
      case 'register':
        out = handleRegister(body);
        break;
      case 'swipe':
        out = handleSwipe(body);
        break;
      default:
        out = createError('Unsupported action: ' + action);
    }
    return respondJson(out);
  }catch(err){
    return respondJson(createError(err));
  }
}

/* ==========================
   HANDLERS
========================== */
function handleRestore(params){
  var code = sanitizeCode(params.code);
  if(!code) return createError('Missing join code');

  var profiles = loadProfiles();
  var me = profiles.map.get(code);
  if(!me) return createError('Profile not found for code ' + code);

  var matches = loadMatchesForCode(code, profiles);
  return { ok:true, profile: extendProfileWithMatches(me, matches), matches: matches };
}

function handleMatches(params){
  var code = sanitizeCode(params.code);
  if(!code) return createError('Missing join code');

  var profiles = loadProfiles();
  var me = profiles.map.get(code);
  if(!me) return createError('Profile not found for code ' + code);

  var matches = loadMatchesForCode(code, profiles);
  return { ok:true, code: code, matches: matches, profile: extendProfileWithMatches(me, matches) };
}

function handleCandidates(params){
  var code = sanitizeCode(params.code);
  if(!code) return createError('Missing join code');

  var profiles = loadProfiles();
  if(!profiles.map.has(code)) return createError('Profile not found for code ' + code);

  var rel = getUserRelations(code, profiles);
  var swipedSet  = rel.swipedTargets;     // already swiped (L/R)
  var matchedSet = rel.matchedPartners;   // already matched

  var candidates = Array.from(profiles.map.values())
    .filter(function(p){ return p.code !== code; })
    .filter(function(p){ return !swipedSet.has(p.code) && !matchedSet.has(p.code); })
    .map(function(p){
      return {
        code: p.code,
        name: p.name,
        campus: p.campus,
        country: p.country,
        background: p.background,
        interests: Array.isArray(p.interests) ? p.interests.slice() : [],
        photo: p.photo || ''
      };
    });

  return { ok:true, candidates: candidates };
}

function handleRegister(body){
  var name       = sanitizeString(body.name);
  var campus     = sanitizeString(body.campus);
  var country    = sanitizeString(body.country);
  var background = sanitizeString(body.background);
  if(!name || !campus || !country || !background){
    return createError('Name, campus, country, and background are required.');
  }
  var interests = normalizeInterests(body.interests);
  var teams     = sanitizeString(body.teams);
  var photo     = sanitizeImageData(body.photoData || body.photo || body.avatar || '');

  var ctx  = loadProfiles();
  var code = generateJoinCode(ctx.map);
  var profile = {
    code: code, name: name, campus: campus, country: country,
    background: background, interests: interests, teams: teams,
    photo: photo,
    timestamp: new Date()
  };
  appendProfile(profile, ctx);

  return { ok:true, code: code, profile: extendProfileWithMatches(profile, []), matches: [] };
}

function handleSwipe(body){
  var code   = sanitizeCode(body.code);
  var target = sanitizeCode(body.target);
  var dir    = String(body.dir || '').toLowerCase();
  if(!code || !target || !dir) return createError('Missing swipe payload');

  var when = new Date();
  recordSwipeEvent({ code: code, target: target, dir: dir, timestamp: when });

  var out = { ok:true, matched:false };
  if(dir === 'right'){
    if(hasMutualSwipe(code, target)){
      var profiles = loadProfiles();
      var partnerProfile = profiles.map.get(target);
      var partner = partnerProfile ? clonePartner(partnerProfile, true) : null;
      recordMatchPair(code, target, when);
      out.matched = true;
      out.partner = partner;
      out.matches = loadMatchesForCode(code, profiles);
    }
  }
  return out;
}

/* ==========================
   DATA ACCESS
========================== */
function loadProfiles(){
  var table = getTable(SHEET_NAMES.PROFILES, DEFAULT_HEADERS.profiles);
  var idx = {
    code:       findColumnIndex(table, PROFILE_ALIASES.code),
    name:       findColumnIndex(table, PROFILE_ALIASES.name),
    campus:     findColumnIndex(table, PROFILE_ALIASES.campus),
    country:    findColumnIndex(table, PROFILE_ALIASES.country),
    background: findColumnIndex(table, PROFILE_ALIASES.background),
    interests:  findColumnIndex(table, PROFILE_ALIASES.interests),
    teams:      findColumnIndex(table, PROFILE_ALIASES.teams),
    photo:      findColumnIndex(table, PROFILE_ALIASES.photo),
    timestamp:  findColumnIndex(table, PROFILE_ALIASES.timestamp)
  };
  if(idx.code === -1) throw new Error('Profiles sheet missing a code column');

  var lastRow = table.sheet.getLastRow();
  var lastCol = table.sheet.getLastColumn();
  var values  = lastRow > 1 ? table.sheet.getRange(2,1,lastRow-1,lastCol).getValues() : [];
  var map = new Map();
  for(var i=0; i<values.length; i++){
    var row  = values[i];
    var code = sanitizeCode(row[idx.code]);
    if(!code) continue;
    map.set(code, {
      code: code,
      name:       idx.name       !== -1 ? sanitizeString(row[idx.name])       : '',
      campus:     idx.campus     !== -1 ? sanitizeString(row[idx.campus])     : '',
      country:    idx.country    !== -1 ? sanitizeString(row[idx.country])    : '',
      background: idx.background !== -1 ? sanitizeString(row[idx.background]) : '',
      interests:  idx.interests  !== -1 ? normalizeInterests(row[idx.interests]) : [],
      teams:      idx.teams      !== -1 ? sanitizeString(row[idx.teams])      : '',
      photo:      idx.photo      !== -1 ? sanitizeImageData(row[idx.photo])    : '',
      timestamp:  idx.timestamp  !== -1 ? parseTimestamp(row[idx.timestamp])  : null
    });
  }
  return { map: map, table: table, indexes: idx };
}

function appendProfile(profile, ctx){
  var t = ctx.table;
  var row = new Array(t.header.length); for(var i=0;i<row.length;i++){ row[i]=''; }
  if(ctx.indexes.timestamp !== -1){ row[ctx.indexes.timestamp] = profile.timestamp instanceof Date ? profile.timestamp : new Date(profile.timestamp||Date.now()); }
  if(ctx.indexes.code      !== -1){ row[ctx.indexes.code]      = profile.code; }
  if(ctx.indexes.name      !== -1){ row[ctx.indexes.name]      = profile.name; }
  if(ctx.indexes.campus    !== -1){ row[ctx.indexes.campus]    = profile.campus; }
  if(ctx.indexes.country   !== -1){ row[ctx.indexes.country]   = profile.country; }
  if(ctx.indexes.background!== -1){ row[ctx.indexes.background]= profile.background; }
  if(ctx.indexes.interests !== -1){ row[ctx.indexes.interests] = profile.interests.join(', '); }
  if(ctx.indexes.teams     !== -1){ row[ctx.indexes.teams]     = profile.teams; }
  if(ctx.indexes.photo     !== -1){ row[ctx.indexes.photo]     = profile.photo || ''; }
  t.sheet.appendRow(row);

  ctx.map.set(profile.code, {
    code: profile.code,
    name: profile.name,
    campus: profile.campus,
    country: profile.country,
    background: profile.background,
    interests: profile.interests.slice(),
    teams: profile.teams,
    photo: profile.photo || '',
    timestamp: profile.timestamp instanceof Date ? profile.timestamp.getTime() : profile.timestamp
  });
}

function loadMatchesForCode(code, profiles){
  var t = getTable(SHEET_NAMES.MATCHES, DEFAULT_HEADERS.matches);
  var idx = {
    codeA:     findColumnIndex(t, MATCH_ALIASES.codeA),
    codeB:     findColumnIndex(t, MATCH_ALIASES.codeB),
    timestamp: findColumnIndex(t, MATCH_ALIASES.timestamp)
  };
  if(idx.codeA === -1 || idx.codeB === -1) throw new Error('Matches sheet missing code columns');

  var lastRow = t.sheet.getLastRow();
  var lastCol = t.sheet.getLastColumn();
  var values  = lastRow > 1 ? t.sheet.getRange(2,1,lastRow-1,lastCol).getValues() : [];
  var pairs = new Map();

  for(var i=0;i<values.length;i++){
    var row   = values[i];
    var a     = sanitizeCode(row[idx.codeA]);
    var b     = sanitizeCode(row[idx.codeB]);
    if(!a || !b) continue;

    var partnerCode;
    if(a === code)      partnerCode = b;
    else if(b === code) partnerCode = a;
    else continue;

    var partnerProfile = profiles.map.get(partnerCode);
    if(!partnerProfile) continue;

    var ts = parseTimestamp(idx.timestamp !== -1 ? row[idx.timestamp] : null);
    var key = makePairKey(code, partnerCode);
    var existing = pairs.get(key);
    if(!existing || existing.ts < ts){
      pairs.set(key, { ts: ts, partner: clonePartner(partnerProfile, true) });
    }
  }

  var out = Array.from(pairs.values());
  out.sort(function(x,y){ return y.ts - x.ts; });
  return out;
}

function recordMatchPair(code, target, when){
  var t = getTable(SHEET_NAMES.MATCHES, DEFAULT_HEADERS.matches);
  var idx = {
    codeA:     findColumnIndex(t, MATCH_ALIASES.codeA),
    codeB:     findColumnIndex(t, MATCH_ALIASES.codeB),
    timestamp: findColumnIndex(t, MATCH_ALIASES.timestamp)
  };
  if(idx.codeA === -1 || idx.codeB === -1) throw new Error('Matches sheet missing code columns');

  var existing = collectExistingPairs(t, idx);
  var key = makePairKey(code, target);
  if(existing.has(key)) return;

  var ts = when instanceof Date ? when : new Date(when || Date.now());
  var row = new Array(t.header.length); for(var i=0;i<row.length;i++){ row[i]=''; }
  if(idx.timestamp !== -1) row[idx.timestamp] = ts;
  if(idx.codeA     !== -1) row[idx.codeA]     = code;
  if(idx.codeB     !== -1) row[idx.codeB]     = target;
  t.sheet.appendRow(row);
}

function collectExistingPairs(t, idx){
  var set = new Set();
  var lastRow = t.sheet.getLastRow();
  if(lastRow <= 1) return set;
  var lastCol = t.sheet.getLastColumn();
  var values  = t.sheet.getRange(2,1,lastRow-1,lastCol).getValues();
  for(var i=0;i<values.length;i++){
    var row = values[i];
    var a   = sanitizeCode(row[idx.codeA]);
    var b   = sanitizeCode(row[idx.codeB]);
    if(a && b) set.add(makePairKey(a,b));
  }
  return set;
}

function recordSwipeEvent(entry){
  var t = getTable(SHEET_NAMES.SWIPES, DEFAULT_HEADERS.swipes);
  var idx = {
    swiper:    findColumnIndex(t, SWIPE_ALIASES.swiper),
    target:    findColumnIndex(t, SWIPE_ALIASES.target),
    dir:       findColumnIndex(t, SWIPE_ALIASES.dir),
    timestamp: findColumnIndex(t, SWIPE_ALIASES.timestamp)
  };
  if(idx.swiper === -1 || idx.target === -1) throw new Error('Swipes sheet missing swiper/target columns');

  var row = new Array(t.header.length); for(var i=0;i<row.length;i++){ row[i]=''; }
  if(idx.timestamp !== -1) row[idx.timestamp] = entry.timestamp instanceof Date ? entry.timestamp : new Date(entry.timestamp||Date.now());
  if(idx.swiper    !== -1) row[idx.swiper]    = entry.code;
  if(idx.target    !== -1) row[idx.target]    = entry.target;
  if(idx.dir       !== -1) row[idx.dir]       = entry.dir;
  t.sheet.appendRow(row);
}

/* ==========================
   RELATIONS / FILTERS
========================== */
function hasMutualSwipe(code, target){
  var t = getTable(SHEET_NAMES.SWIPES, DEFAULT_HEADERS.swipes);
  var idx = {
    swiper: findColumnIndex(t, SWIPE_ALIASES.swiper),
    target: findColumnIndex(t, SWIPE_ALIASES.target),
    dir:    findColumnIndex(t, SWIPE_ALIASES.dir)
  };
  if(idx.swiper === -1 || idx.target === -1 || idx.dir === -1) return false;

  var lastRow = t.sheet.getLastRow();
  if(lastRow <= 1) return false;

  var lastCol = t.sheet.getLastColumn();
  var values  = t.sheet.getRange(2,1,lastRow-1,lastCol).getValues();
  var wantSwiper = sanitizeCode(target);
  var wantTarget = sanitizeCode(code);
  for(var i=0;i<values.length;i++){
    var row = values[i];
    var swiper = sanitizeCode(row[idx.swiper]);
    var cand   = sanitizeCode(row[idx.target]);
    var dir    = String(row[idx.dir] || '').toLowerCase();
    if(swiper === wantSwiper && cand === wantTarget && dir === 'right') return true;
  }
  return false;
}

/** Returns:
 *  { swipedTargets:Set<code>, matchedPartners:Set<code> }
 */
function getUserRelations(code, profiles){
  var swipedTargets = new Set();
  var st = getTable(SHEET_NAMES.SWIPES, DEFAULT_HEADERS.swipes);
  var sIdx = {
    swiper: findColumnIndex(st, SWIPE_ALIASES.swiper),
    target: findColumnIndex(st, SWIPE_ALIASES.target)
  };
  if(sIdx.swiper !== -1 && sIdx.target !== -1){
    var lastRow = st.sheet.getLastRow();
    if(lastRow > 1){
      var lastCol = st.sheet.getLastColumn();
      var values  = st.sheet.getRange(2,1,lastRow-1,lastCol).getValues();
      for(var i=0;i<values.length;i++){
        var row = values[i];
        var swiper = sanitizeCode(row[sIdx.swiper]);
        var target = sanitizeCode(row[sIdx.target]);
        if(swiper === code && target){ swipedTargets.add(target); }
      }
    }
  }

  var matchedPartners = new Set();
  var matches = loadMatchesForCode(code, profiles);
  for(var j=0;j<matches.length;j++){
    var p = matches[j].partner;
    var partnerCode = (p && p.code) ? sanitizeCode(p.code) : null;
    if(partnerCode) matchedPartners.add(partnerCode);
  }
  return { swipedTargets: swipedTargets, matchedPartners: matchedPartners };
}

/* ==========================
   DTOs / UTILS
========================== */
function extendProfileWithMatches(p, matches){
  var out = {
    code: p.code,
    name: p.name,
    campus: p.campus,
    country: p.country,
    background: p.background,
    interests: Array.isArray(p.interests) ? p.interests.slice() : [],
    teams: p.teams || '',
    photo: p.photo || ''
  };
  if(p.timestamp){
    out.timestamp = (typeof p.timestamp === 'number') ? p.timestamp : parseTimestamp(p.timestamp);
  }
  out.matches = Array.isArray(matches) ? matches.slice() : [];
  return out;
}

function clonePartner(p, includeCode){
  return {
    code: includeCode ? (p.code || '') : undefined,
    name: p.name || '',
    campus: p.campus || '',
    country: p.country || '',
    background: p.background || '',
    interests: Array.isArray(p.interests) ? p.interests.slice() : [],
    teams: p.teams || '',
    photo: p.photo || ''
  };
}

function generateJoinCode(existingMap){
  var alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for(var tries=0; tries<1000; tries++){
    var c = '';
    for(var i=0;i<6;i++){ c += alphabet.charAt(Math.floor(Math.random()*alphabet.length)); }
    if(!existingMap.has(c)) return c;
  }
  throw new Error('Unable to generate unique join code');
}

function getTable(name, defaultHeader){
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName(name);
  if(!sheet){
    var sheets = ss.getSheets();
    var lower = name.toLowerCase();
    for(var i=0;i<sheets.length;i++){
      var cand = sheets[i];
      if(cand.getName().toLowerCase() === lower){ sheet = cand; break; }
    }
  }
  if(!sheet) sheet = ss.insertSheet(name);
  if(sheet.getLastRow() === 0 && defaultHeader && defaultHeader.length){
    sheet.getRange(1,1,1,defaultHeader.length).setValues([defaultHeader]);
  }
  var lastCol = sheet.getLastColumn();
  if(lastCol === 0 && defaultHeader && defaultHeader.length) lastCol = defaultHeader.length;
  var header = lastCol > 0 ? sheet.getRange(1,1,1,lastCol).getValues()[0] : [];
  var map = buildHeaderIndex(header);
  if(defaultHeader && defaultHeader.length){
    var missing = [];
    for(var i=0;i<defaultHeader.length;i++){
      var key = normalizeKey(defaultHeader[i]);
      if(key && map[key] === undefined){ missing.push(defaultHeader[i]); }
    }
    if(missing.length){
      sheet.getRange(1, header.length+1, 1, missing.length).setValues([missing]);
      for(var j=0;j<missing.length;j++){
        var colName = missing[j];
        header.push(colName);
        var mk = normalizeKey(colName);
        if(mk && map[mk] === undefined){ map[mk] = header.length - 1; }
      }
    }
  }
  return { sheet: sheet, header: header, map: map };
}

function buildHeaderIndex(header){
  var map = {};
  for(var i=0;i<header.length;i++){
    var key = normalizeKey(header[i]);
    if(key && map[key] === undefined) map[key] = i;
  }
  return map;
}

function findColumnIndex(table, aliases){
  if(!aliases || !aliases.length) return -1;
  for(var i=0;i<aliases.length;i++){
    var key = normalizeKey(aliases[i]);
    if(key && table.map.hasOwnProperty(key)) return table.map[key];
  }
  return -1;
}

function normalizeKey(v){
  if(v === null || v === undefined) return '';
  return String(v).toLowerCase().replace(/[^a-z0-9]+/g,'');
}

function sanitizeCode(v){
  var s = sanitizeString(v);
  return s ? s.toUpperCase() : '';
}

function sanitizeString(v){
  if(v === null || v === undefined) return '';
  if(v instanceof Date){
    return Utilities.formatDate(v, Session.getScriptTimeZone(), "yyyy-MM-dd'T'HH:mm:ssXXX");
  }
  return String(v).trim();
}

function sanitizeImageData(v){
  var s = sanitizeString(v);
  if(!s) return '';
  var trimmed = s.trim();
  var match = trimmed.match(/^data:image\/(png|jpe?g|webp);base64,/i);
  if(!match) return '';
  var maxLength = 48000; // Google Sheets cell limit (~50k chars)
  if(trimmed.length > maxLength) return '';
  var prefix = match[0];
  var payload = trimmed.substring(prefix.length).replace(/\s+/g, '');
  if(/[^A-Za-z0-9+/=]/.test(payload)) return '';
  return prefix + payload;
}

function normalizeInterests(v){
  if(Array.isArray(v)){
    return v.map(function(x){ return sanitizeString(x); }).filter(function(x){ return x.length; });
  }
  var s = sanitizeString(v);
  if(!s) return [];
  return s.split(/[,;|]/).map(function(x){ return x.trim(); }).filter(function(x){ return x.length; });
}

function parseTimestamp(v){
  if(v instanceof Date) return v.getTime();
  if(typeof v === 'number' && !isNaN(v)){
    if(v > 1e12) return Math.round(v);
    if(v > 1e9)  return Math.round(v*1000);
    return Math.round(EXCEL_EPOCH + v * MS_PER_DAY);
  }
  var s = sanitizeString(v);
  if(!s) return Date.now();
  var t = Date.parse(s);
  return isNaN(t) ? Date.now() : t;
}

function parseBody(e){
  if(!e || !e.postData || !e.postData.contents) return {};
  try { return JSON.parse(e.postData.contents); }
  catch(_e){ throw new Error('Invalid JSON payload'); }
}

function respondJson(payload){
  var out = ContentService.createTextOutput(JSON.stringify(payload))
                          .setMimeType(ContentService.MimeType.JSON);
  // These headers help prevent caching; not required for CORS when using "simple" requests.
  if(out.setHeader){
    out.setHeader('Cache-Control','no-store, no-cache, must-revalidate, max-age=0')
       .setHeader('Pragma','no-cache')
       .setHeader('Expires','0');
  }
  return out;
}

function createError(err){
  var msg = err && err.message ? err.message : String(err);
  return { ok:false, error: msg };
}

function makePairKey(a,b){
  var x = sanitizeCode(a), y = sanitizeCode(b);
  return x < y ? (x+'|'+y) : (y+'|'+x);
}

function getSpreadsheet(){
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('SPREADSHEET_ID');
  if(id){
    try { return SpreadsheetApp.openById(id); }
    catch(_e){ /* fall back to active */ }
  }
  return SpreadsheetApp.getActive();
}
