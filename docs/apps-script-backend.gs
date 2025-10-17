/**
 * Google Apps Script backend for Yoobee Connect.
 *
 * The service exposes a lightweight JSON API consumed by the web app.
 * It stores profiles, swipe events, and matches in dedicated sheets inside
 * the companion spreadsheet. This module focuses on match retrieval so
 * the client can stay in sync without reloading the entire profile.
 */

var SHEET_NAMES = {
  PROFILES: 'profiles',
  SWIPES: 'swipes',
  MATCHES: 'matches'
};

var DEFAULT_HEADERS = {
  profiles: ['timestamp', 'code', 'name', 'campus', 'country', 'background', 'interests', 'teams'],
  swipes: ['timestamp', 'swiper', 'target', 'dir'],
  matches: ['timestamp', 'code_a', 'code_b']
};

var PROFILE_ALIASES = {
  code: ['code', 'join_code', 'joincode', 'profile_code', 'id'],
  name: ['name', 'full_name', 'fullname', 'display_name', 'displayname'],
  campus: ['campus', 'campus_name', 'campusname', 'location'],
  country: ['country', 'country_name', 'countryname', 'nation'],
  background: ['background', 'programme', 'program', 'study', 'major', 'course'],
  interests: ['interests', 'interest', 'tags', 'skills'],
  teams: ['teams', 'contact', 'email', 'handle', 'reachout'],
  timestamp: ['timestamp', 'ts', 'created', 'created_at', 'createdat', 'submitted']
};

var SWIPE_ALIASES = {
  swiper: ['swiper', 'code', 'from', 'source', 'source_code'],
  target: ['target', 'candidate', 'to', 'destination', 'target_code'],
  dir: ['dir', 'direction', 'choice', 'decision', 'swipe'],
  timestamp: ['timestamp', 'ts', 'created', 'created_at', 'createdat']
};

var MATCH_ALIASES = {
  codeA: ['code_a', 'codea', 'user_a', 'usera', 'initiator', 'source', 'from'],
  codeB: ['code_b', 'codeb', 'user_b', 'userb', 'partner', 'target', 'to'],
  timestamp: ['timestamp', 'ts', 'matched_at', 'matchedat', 'created', 'created_at', 'createdat', 'time']
};

var MS_PER_DAY = 24 * 60 * 60 * 1000;
var EXCEL_EPOCH = new Date('1899-12-30T00:00:00Z').getTime();

function doGet(e){
  try{
    var params = e && e.parameter ? e.parameter : {};
    var action = (params.action || '').toLowerCase();
    var result;
    switch(action){
      case 'restore':
        result = handleRestore(params);
        break;
      case 'matches':
        result = handleMatches(params);
        break;
      case 'candidates':
        result = handleCandidates(params);
        break;
      default:
        result = createError('Unsupported action: ' + action);
    }
    return respondJson(result);
  }catch(err){
    return respondJson(createError(err));
  }
}

function doPost(e){
  try{
    var body = parseBody(e);
    var action = (body.action || '').toLowerCase();
    var result;
    switch(action){
      case 'register':
        result = handleRegister(body);
        break;
      case 'swipe':
        result = handleSwipe(body);
        break;
      default:
        result = createError('Unsupported action: ' + action);
    }
    return respondJson(result);
  }catch(err){
    return respondJson(createError(err));
  }
}

function handleRestore(params){
  var code = sanitizeCode(params.code);
  if(!code){
    return createError('Missing join code');
  }
  var profileContext = loadProfiles();
  var profile = profileContext.map.get(code);
  if(!profile){
    return createError('Profile not found for code ' + code);
  }
  var matches = loadMatchesForCode(code, profileContext);
  var enriched = extendProfileWithMatches(profile, matches);
  return { ok:true, profile: enriched, matches: matches };
}

function handleMatches(params){
  var code = sanitizeCode(params.code);
  if(!code){
    return createError('Missing join code');
  }
  var profileContext = loadProfiles();
  var profile = profileContext.map.get(code);
  if(!profile){
    return createError('Profile not found for code ' + code);
  }
  var matches = loadMatchesForCode(code, profileContext);
  return { ok:true, code: code, matches: matches, profile: extendProfileWithMatches(profile, matches) };
}

function handleCandidates(params){
  var code = sanitizeCode(params.code);
  if(!code){
    return createError('Missing join code');
  }
  var profileContext = loadProfiles();
  var profiles = Array.from(profileContext.map.values());
  if(!profileContext.map.has(code)){
    return createError('Profile not found for code ' + code);
  }
  var candidates = profiles
    .filter(function(p){ return p.code !== code; })
    .map(function(p){
      return {
        code: p.code,
        name: p.name,
        campus: p.campus,
        country: p.country,
        background: p.background,
        interests: Array.isArray(p.interests) ? p.interests.slice() : []
      };
    });
  return { ok:true, candidates: candidates };
}

function handleRegister(body){
  var name = sanitizeString(body.name);
  var campus = sanitizeString(body.campus);
  var country = sanitizeString(body.country);
  var background = sanitizeString(body.background);
  if(!name || !campus || !country || !background){
    return createError('Name, campus, country, and background are required.');
  }
  var interests = normalizeInterests(body.interests);
  var teams = sanitizeString(body.teams);
  var context = loadProfiles();
  var code = generateJoinCode(context.map);
  var profile = {
    code: code,
    name: name,
    campus: campus,
    country: country,
    background: background,
    interests: interests,
    teams: teams,
    timestamp: new Date()
  };
  appendProfile(profile, context);
  var enriched = extendProfileWithMatches(profile, []);
  return { ok:true, code: code, profile: enriched, matches: [] };
}

function handleSwipe(body){
  var code = sanitizeCode(body.code);
  var target = sanitizeCode(body.target);
  var dir = String(body.dir || '').toLowerCase();
  if(!code || !target || !dir){
    return createError('Missing swipe payload');
  }
  var when = new Date();
  recordSwipeEvent({ code: code, target: target, dir: dir, timestamp: when });
  var result = { ok:true, matched:false };
  if(dir === 'right'){
    var mutual = hasMutualSwipe(code, target);
    if(mutual){
      var profileContext = loadProfiles();
      var partnerProfile = profileContext.map.get(target);
      var partner = partnerProfile ? clonePartner(partnerProfile) : null;
      recordMatchPair(code, target, when);
      result.matched = true;
      result.partner = partner;
      result.matches = loadMatchesForCode(code, profileContext);
    }
  }
  return result;
}

function loadProfiles(){
  var table = getTable(SHEET_NAMES.PROFILES, DEFAULT_HEADERS.profiles);
  var indexes = {
    code: findColumnIndex(table, PROFILE_ALIASES.code),
    name: findColumnIndex(table, PROFILE_ALIASES.name),
    campus: findColumnIndex(table, PROFILE_ALIASES.campus),
    country: findColumnIndex(table, PROFILE_ALIASES.country),
    background: findColumnIndex(table, PROFILE_ALIASES.background),
    interests: findColumnIndex(table, PROFILE_ALIASES.interests),
    teams: findColumnIndex(table, PROFILE_ALIASES.teams),
    timestamp: findColumnIndex(table, PROFILE_ALIASES.timestamp)
  };
  if(indexes.code === -1){
    throw new Error('Profiles sheet missing a code column');
  }
  var lastRow = table.sheet.getLastRow();
  var lastColumn = table.sheet.getLastColumn();
  var values = lastRow > 1 ? table.sheet.getRange(2, 1, lastRow - 1, lastColumn).getValues() : [];
  var map = new Map();
  for(var i = 0; i < values.length; i++){
    var row = values[i];
    var code = sanitizeCode(row[indexes.code]);
    if(!code){
      continue;
    }
    map.set(code, {
      code: code,
      name: indexes.name !== -1 ? sanitizeString(row[indexes.name]) : '',
      campus: indexes.campus !== -1 ? sanitizeString(row[indexes.campus]) : '',
      country: indexes.country !== -1 ? sanitizeString(row[indexes.country]) : '',
      background: indexes.background !== -1 ? sanitizeString(row[indexes.background]) : '',
      interests: indexes.interests !== -1 ? normalizeInterests(row[indexes.interests]) : [],
      teams: indexes.teams !== -1 ? sanitizeString(row[indexes.teams]) : '',
      timestamp: indexes.timestamp !== -1 ? parseTimestamp(row[indexes.timestamp]) : null
    });
  }
  return { map: map, table: table, indexes: indexes };
}

function appendProfile(profile, context){
  var table = context.table;
  var row = new Array(table.header.length);
  for(var i = 0; i < row.length; i++){ row[i] = ''; }
  if(context.indexes.timestamp !== -1){
    row[context.indexes.timestamp] = profile.timestamp instanceof Date ? profile.timestamp : new Date(profile.timestamp || Date.now());
  }
  if(context.indexes.code !== -1){ row[context.indexes.code] = profile.code; }
  if(context.indexes.name !== -1){ row[context.indexes.name] = profile.name; }
  if(context.indexes.campus !== -1){ row[context.indexes.campus] = profile.campus; }
  if(context.indexes.country !== -1){ row[context.indexes.country] = profile.country; }
  if(context.indexes.background !== -1){ row[context.indexes.background] = profile.background; }
  if(context.indexes.interests !== -1){ row[context.indexes.interests] = profile.interests.join(', '); }
  if(context.indexes.teams !== -1){ row[context.indexes.teams] = profile.teams; }
  table.sheet.appendRow(row);
  context.map.set(profile.code, {
    code: profile.code,
    name: profile.name,
    campus: profile.campus,
    country: profile.country,
    background: profile.background,
    interests: profile.interests.slice(),
    teams: profile.teams,
    timestamp: profile.timestamp instanceof Date ? profile.timestamp.getTime() : profile.timestamp
  });
}

function loadMatchesForCode(code, profileContext){
  var table = getTable(SHEET_NAMES.MATCHES, DEFAULT_HEADERS.matches);
  var indexes = {
    codeA: findColumnIndex(table, MATCH_ALIASES.codeA),
    codeB: findColumnIndex(table, MATCH_ALIASES.codeB),
    timestamp: findColumnIndex(table, MATCH_ALIASES.timestamp)
  };
  if(indexes.codeA === -1 || indexes.codeB === -1){
    throw new Error('Matches sheet missing code columns');
  }
  var lastRow = table.sheet.getLastRow();
  var lastColumn = table.sheet.getLastColumn();
  var values = lastRow > 1 ? table.sheet.getRange(2, 1, lastRow - 1, lastColumn).getValues() : [];
  var pairs = new Map();
  for(var i = 0; i < values.length; i++){
    var row = values[i];
    var codeA = sanitizeCode(row[indexes.codeA]);
    var codeB = sanitizeCode(row[indexes.codeB]);
    if(!codeA || !codeB){
      continue;
    }
    var partnerCode;
    if(codeA === code){
      partnerCode = codeB;
    }else if(codeB === code){
      partnerCode = codeA;
    }else{
      continue;
    }
    var partnerProfile = profileContext.map.get(partnerCode);
    if(!partnerProfile){
      continue;
    }
    var tsValue = indexes.timestamp !== -1 ? row[indexes.timestamp] : null;
    var ts = parseTimestamp(tsValue);
    var key = makePairKey(code, partnerCode);
    var existing = pairs.get(key);
    if(!existing || existing.ts < ts){
      pairs.set(key, { ts: ts, partner: clonePartner(partnerProfile) });
    }
  }
  var matches = Array.from(pairs.values());
  matches.sort(function(a, b){ return b.ts - a.ts; });
  return matches;
}

function recordMatchPair(code, target, when){
  var table = getTable(SHEET_NAMES.MATCHES, DEFAULT_HEADERS.matches);
  var indexes = {
    codeA: findColumnIndex(table, MATCH_ALIASES.codeA),
    codeB: findColumnIndex(table, MATCH_ALIASES.codeB),
    timestamp: findColumnIndex(table, MATCH_ALIASES.timestamp)
  };
  if(indexes.codeA === -1 || indexes.codeB === -1){
    throw new Error('Matches sheet missing code columns');
  }
  var existingPairs = collectExistingPairs(table, indexes);
  var key = makePairKey(code, target);
  var ts = when instanceof Date ? when : new Date(when || Date.now());
  if(existingPairs.has(key)){
    return;
  }
  var row = new Array(table.header.length);
  for(var i = 0; i < row.length; i++){ row[i] = ''; }
  if(indexes.timestamp !== -1){ row[indexes.timestamp] = ts; }
  if(indexes.codeA !== -1){ row[indexes.codeA] = code; }
  if(indexes.codeB !== -1){ row[indexes.codeB] = target; }
  table.sheet.appendRow(row);
}

function collectExistingPairs(table, indexes){
  var set = new Set();
  var lastRow = table.sheet.getLastRow();
  if(lastRow <= 1){
    return set;
  }
  var lastColumn = table.sheet.getLastColumn();
  var values = table.sheet.getRange(2, 1, lastRow - 1, lastColumn).getValues();
  for(var i = 0; i < values.length; i++){
    var row = values[i];
    var codeA = sanitizeCode(row[indexes.codeA]);
    var codeB = sanitizeCode(row[indexes.codeB]);
    if(codeA && codeB){
      set.add(makePairKey(codeA, codeB));
    }
  }
  return set;
}

function recordSwipeEvent(entry){
  var table = getTable(SHEET_NAMES.SWIPES, DEFAULT_HEADERS.swipes);
  var indexes = {
    swiper: findColumnIndex(table, SWIPE_ALIASES.swiper),
    target: findColumnIndex(table, SWIPE_ALIASES.target),
    dir: findColumnIndex(table, SWIPE_ALIASES.dir),
    timestamp: findColumnIndex(table, SWIPE_ALIASES.timestamp)
  };
  if(indexes.swiper === -1 || indexes.target === -1){
    throw new Error('Swipes sheet missing swiper/target columns');
  }
  var row = new Array(table.header.length);
  for(var i = 0; i < row.length; i++){ row[i] = ''; }
  if(indexes.timestamp !== -1){ row[indexes.timestamp] = entry.timestamp instanceof Date ? entry.timestamp : new Date(entry.timestamp || Date.now()); }
  if(indexes.swiper !== -1){ row[indexes.swiper] = entry.code; }
  if(indexes.target !== -1){ row[indexes.target] = entry.target; }
  if(indexes.dir !== -1){ row[indexes.dir] = entry.dir; }
  table.sheet.appendRow(row);
}

function hasMutualSwipe(code, target){
  var table = getTable(SHEET_NAMES.SWIPES, DEFAULT_HEADERS.swipes);
  var indexes = {
    swiper: findColumnIndex(table, SWIPE_ALIASES.swiper),
    target: findColumnIndex(table, SWIPE_ALIASES.target),
    dir: findColumnIndex(table, SWIPE_ALIASES.dir)
  };
  if(indexes.swiper === -1 || indexes.target === -1 || indexes.dir === -1){
    return false;
  }
  var lastRow = table.sheet.getLastRow();
  if(lastRow <= 1){
    return false;
  }
  var lastColumn = table.sheet.getLastColumn();
  var values = table.sheet.getRange(2, 1, lastRow - 1, lastColumn).getValues();
  var desiredSwiper = sanitizeCode(target);
  var desiredTarget = sanitizeCode(code);
  for(var i = 0; i < values.length; i++){
    var row = values[i];
    var swiper = sanitizeCode(row[indexes.swiper]);
    var candidate = sanitizeCode(row[indexes.target]);
    var dir = String(row[indexes.dir] || '').toLowerCase();
    if(swiper === desiredSwiper && candidate === desiredTarget && dir === 'right'){
      return true;
    }
  }
  return false;
}

function extendProfileWithMatches(profile, matches){
  var clone = {
    code: profile.code,
    name: profile.name,
    campus: profile.campus,
    country: profile.country,
    background: profile.background,
    interests: Array.isArray(profile.interests) ? profile.interests.slice() : [],
    teams: profile.teams || ''
  };
  if(profile.timestamp){
    clone.timestamp = typeof profile.timestamp === 'number' ? profile.timestamp : parseTimestamp(profile.timestamp);
  }
  clone.matches = Array.isArray(matches) ? matches.slice() : [];
  return clone;
}

function clonePartner(profile){
  return {
    name: profile.name || '',
    campus: profile.campus || '',
    country: profile.country || '',
    background: profile.background || '',
    interests: Array.isArray(profile.interests) ? profile.interests.slice() : [],
    teams: profile.teams || ''
  };
}

function generateJoinCode(existingMap){
  var alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for(var attempts = 0; attempts < 1000; attempts++){
    var code = '';
    for(var i = 0; i < 6; i++){
      code += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
    }
    if(!existingMap.has(code)){
      return code;
    }
  }
  throw new Error('Unable to generate unique join code');
}

function getTable(preferredName, defaultHeader){
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName(preferredName);
  if(!sheet){
    var sheets = ss.getSheets();
    var lower = preferredName.toLowerCase();
    for(var i = 0; i < sheets.length; i++){
      var candidate = sheets[i];
      if(candidate.getName().toLowerCase() === lower){
        sheet = candidate;
        break;
      }
    }
  }
  if(!sheet){
    sheet = ss.insertSheet(preferredName);
  }
  if(sheet.getLastRow() === 0 && defaultHeader && defaultHeader.length){
    sheet.getRange(1, 1, 1, defaultHeader.length).setValues([defaultHeader]);
  }
  var lastColumn = sheet.getLastColumn();
  if(lastColumn === 0 && defaultHeader && defaultHeader.length){
    lastColumn = defaultHeader.length;
  }
  var header = lastColumn > 0 ? sheet.getRange(1, 1, 1, lastColumn).getValues()[0] : [];
  var map = buildHeaderIndex(header);
  return { sheet: sheet, header: header, map: map };
}

function buildHeaderIndex(header){
  var map = {};
  for(var i = 0; i < header.length; i++){
    var key = normalizeKey(header[i]);
    if(key && map[key] === undefined){
      map[key] = i;
    }
  }
  return map;
}

function findColumnIndex(table, aliases){
  if(!aliases || !aliases.length){
    return -1;
  }
  for(var i = 0; i < aliases.length; i++){
    var key = normalizeKey(aliases[i]);
    if(key && table.map.hasOwnProperty(key)){
      return table.map[key];
    }
  }
  return -1;
}

function normalizeKey(value){
  if(value === null || value === undefined){
    return '';
  }
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function sanitizeCode(value){
  var str = sanitizeString(value);
  return str ? str.toUpperCase() : '';
}

function sanitizeString(value){
  if(value === null || value === undefined){
    return '';
  }
  if(value instanceof Date){
    return Utilities.formatDate(value, Session.getScriptTimeZone(), "yyyy-MM-dd'T'HH:mm:ssXXX");
  }
  return String(value).trim();
}

function normalizeInterests(value){
  if(Array.isArray(value)){
    return value
      .map(function(item){ return sanitizeString(item); })
      .filter(function(item){ return item.length; });
  }
  var str = sanitizeString(value);
  if(!str){
    return [];
  }
  return str
    .split(/[,;|]/)
    .map(function(item){ return item.trim(); })
    .filter(function(item){ return item.length; });
}

function parseTimestamp(value){
  if(value instanceof Date){
    return value.getTime();
  }
  if(typeof value === 'number' && !isNaN(value)){
    if(value > 1e12){
      return Math.round(value);
    }
    if(value > 1e9){
      return Math.round(value * 1000);
    }
    return Math.round(EXCEL_EPOCH + value * MS_PER_DAY);
  }
  var str = sanitizeString(value);
  if(!str){
    return Date.now();
  }
  var parsed = Date.parse(str);
  if(isNaN(parsed)){
    return Date.now();
  }
  return parsed;
}

function parseBody(e){
  if(!e || !e.postData || !e.postData.contents){
    return {};
  }
  try{
    return JSON.parse(e.postData.contents);
  }catch(err){
    throw new Error('Invalid JSON payload');
  }
}

function respondJson(payload){
  var output = ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
  if(output.setHeader){
    output
      .setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
      .setHeader('Pragma', 'no-cache')
      .setHeader('Expires', '0');
  }
  return output;
}

function createError(error){
  var message = error && error.message ? error.message : String(error);
  return { ok:false, error: message };
}

function makePairKey(a, b){
  var one = sanitizeCode(a);
  var two = sanitizeCode(b);
  return one < two ? one + '|' + two : two + '|' + one;
}

function getSpreadsheet(){
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('SPREADSHEET_ID');
  if(id){
    try{
      return SpreadsheetApp.openById(id);
    }catch(err){
      // fall back to active spreadsheet
    }
  }
  return SpreadsheetApp.getActive();
}
