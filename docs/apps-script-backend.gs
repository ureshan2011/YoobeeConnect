/**
 * Yoobee Connect — Student data backend (Google Apps Script)
 *
 * Supported endpoints:
 *   GET  ?action=ping
 *   GET  ?action=dashboard_summary
 *   GET  ?action=students
 *   POST {action:'register', code?, name, campus, homeCountry, programme, email, notes?}
 *   POST {action:'update', code, name?, campus?, homeCountry?, programme?, email?, notes?}
 *   POST {action:'reset_data', confirmToken:'ERASE_ALL_2026'}
 */

var SHEET_NAME = 'profiles';
var PROFILE_HEADERS = ['timestamp','code','name','campus','home_country','programme','email','notes'];
var RESET_TOKEN = 'ERASE_ALL_2026';

var PROFILE_ALIASES = {
  timestamp:   ['timestamp','ts','created','created_at'],
  code:        ['code','student_id','studentid','id','join_code'],
  name:        ['name','full_name','fullname'],
  campus:      ['campus','campus_name','location'],
  homeCountry: ['home_country','homecountry','country','country_name','nation'],
  programme:   ['programme','program','background','major','course'],
  email:       ['email','contact','contact_email','teams'],
  notes:       ['notes','note','comments','comment']
};

function doGet(e){
  try{
    var params = (e && e.parameter) ? e.parameter : {};
    var action = sanitizeString(params.action).toLowerCase();
    if(action === 'ping') return respondJson({ ok: true, version: 'student-insights-2026-04-10' });
    if(action === 'dashboard_summary') return respondJson(handleDashboardSummary());
    if(action === 'students') return respondJson(handleStudents());
    return respondJson(createError('Unsupported action: ' + action));
  }catch(err){
    return respondJson(createError(err));
  }
}

function doPost(e){
  try{
    var body = parseBody(e);
    var action = sanitizeString(body.action).toLowerCase();
    if(action === 'register') return respondJson(handleRegister(body));
    if(action === 'update') return respondJson(handleUpdate(body));
    if(action === 'reset_data') return respondJson(handleResetData(body));
    return respondJson(createError('Unsupported action: ' + action));
  }catch(err){
    return respondJson(createError(err));
  }
}

function handleRegister(body){
  var table = loadProfiles();
  var profile = buildProfilePayload(body, null, table.map);
  appendProfile(profile, table);
  return { ok: true, profile: cloneProfile(profile) };
}

function handleUpdate(body){
  var code = sanitizeCode(body.code);
  if(!code) return createError('Missing code for update');

  var table = loadProfiles();
  var existing = table.map.get(code);
  if(!existing) return createError('Profile not found for code ' + code);

  var profile = buildProfilePayload(body, existing, table.map);
  profile.row = existing.row;
  updateProfile(profile, table);
  return { ok: true, profile: cloneProfile(profile) };
}

function handleResetData(body){
  var token = sanitizeString(body.confirmToken);
  if(token !== RESET_TOKEN){
    return createError('Invalid confirm token. Set confirmToken to ERASE_ALL_2026.');
  }

  var table = getTable(SHEET_NAME, PROFILE_HEADERS);
  var header = table.header.length ? table.header : PROFILE_HEADERS.slice();
  table.sheet.clearContents();
  table.sheet.getRange(1,1,1,header.length).setValues([header]);
  return { ok: true, message: 'All student profile data has been deleted.' };
}

function handleStudents(){
  var table = loadProfiles();
  var students = Array.from(table.map.values()).map(function(row){
    return {
      code: row.code,
      name: row.name,
      campus: row.campus,
      homeCountry: row.homeCountry,
      programme: row.programme,
      notes: row.notes,
      timestamp: row.timestamp
    };
  });
  students.sort(function(a,b){ return b.timestamp - a.timestamp; });
  return { ok: true, total: students.length, students: students };
}

function handleDashboardSummary(){
  var table = loadProfiles();
  var list = Array.from(table.map.values());

  var campusCounts = countBy(list, function(p){ return p.campus; });
  var countryCounts = countBy(list, function(p){ return p.homeCountry; });
  var programmeCounts = countBy(list, function(p){ return p.programme; });

  return {
    ok: true,
    totalStudents: list.length,
    campuses: toCountArray(campusCounts),
    countries: toCountArray(countryCounts),
    programmes: toCountArray(programmeCounts)
  };
}

function loadProfiles(){
  var table = getTable(SHEET_NAME, PROFILE_HEADERS);
  var idx = {
    timestamp: findColumnIndex(table, PROFILE_ALIASES.timestamp),
    code: findColumnIndex(table, PROFILE_ALIASES.code),
    name: findColumnIndex(table, PROFILE_ALIASES.name),
    campus: findColumnIndex(table, PROFILE_ALIASES.campus),
    homeCountry: findColumnIndex(table, PROFILE_ALIASES.homeCountry),
    programme: findColumnIndex(table, PROFILE_ALIASES.programme),
    email: findColumnIndex(table, PROFILE_ALIASES.email),
    notes: findColumnIndex(table, PROFILE_ALIASES.notes)
  };

  var rows = table.sheet.getLastRow();
  var cols = table.sheet.getLastColumn();
  var values = rows > 1 ? table.sheet.getRange(2, 1, rows - 1, cols).getValues() : [];

  var map = new Map();
  for(var i = 0; i < values.length; i++){
    var row = values[i];
    var code = sanitizeCode(getValue(row, idx.code));
    if(!code) continue;

    map.set(code, {
      row: i + 2,
      timestamp: parseTimestamp(getValue(row, idx.timestamp)),
      code: code,
      name: sanitizeString(getValue(row, idx.name)),
      campus: sanitizeString(getValue(row, idx.campus)),
      homeCountry: sanitizeString(getValue(row, idx.homeCountry)),
      programme: sanitizeString(getValue(row, idx.programme)),
      email: sanitizeString(getValue(row, idx.email)),
      notes: sanitizeString(getValue(row, idx.notes))
    });
  }

  return { table: table, indexes: idx, map: map };
}

function appendProfile(profile, ctx){
  var row = new Array(ctx.table.header.length);
  for(var i=0;i<row.length;i++){ row[i] = ''; }
  applyProfileToRow(row, profile, ctx.indexes);
  ctx.table.sheet.appendRow(row);
}

function updateProfile(profile, ctx){
  var row = ctx.table.sheet.getRange(profile.row, 1, 1, ctx.table.header.length).getValues()[0];
  applyProfileToRow(row, profile, ctx.indexes);
  ctx.table.sheet.getRange(profile.row, 1, 1, row.length).setValues([row]);
}

function applyProfileToRow(row, profile, idx){
  setValue(row, idx.timestamp, new Date(profile.timestamp));
  setValue(row, idx.code, profile.code);
  setValue(row, idx.name, profile.name);
  setValue(row, idx.campus, profile.campus);
  setValue(row, idx.homeCountry, profile.homeCountry);
  setValue(row, idx.programme, profile.programme);
  setValue(row, idx.email, profile.email);
  setValue(row, idx.notes, profile.notes);
}

function buildProfilePayload(body, existing, existingMap){
  var inputCode = sanitizeCode(body.code);
  var code = inputCode || (existing ? existing.code : generateCode(existingMap));
  if(!code) throw new Error('Could not generate student code');

  var profile = {
    timestamp: Date.now(),
    code: code,
    name: sanitizeString(body.name) || (existing ? existing.name : ''),
    campus: sanitizeString(body.campus) || (existing ? existing.campus : ''),
    homeCountry: sanitizeString(body.homeCountry || body.country) || (existing ? existing.homeCountry : ''),
    programme: sanitizeString(body.programme || body.background) || (existing ? existing.programme : ''),
    email: sanitizeString(body.email || body.contact) || (existing ? existing.email : ''),
    notes: sanitizeString(body.notes) || (existing ? existing.notes : '')
  };

  if(!profile.name || !profile.campus || !profile.homeCountry || !profile.programme || !profile.email){
    throw new Error('name, campus, homeCountry, programme, and email are required');
  }
  return profile;
}

function generateCode(existingMap){
  var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for(var t=0;t<1000;t++){
    var code = '';
    for(var i=0;i<6;i++) code += chars.charAt(Math.floor(Math.random() * chars.length));
    if(!existingMap.has(code)) return code;
  }
  return '';
}

function cloneProfile(p){
  return {
    timestamp: p.timestamp,
    code: p.code,
    name: p.name,
    campus: p.campus,
    homeCountry: p.homeCountry,
    programme: p.programme,
    email: p.email,
    notes: p.notes
  };
}

function countBy(list, selector){
  var map = new Map();
  for(var i=0;i<list.length;i++){
    var key = sanitizeString(selector(list[i]));
    if(!key) continue;
    map.set(key, (map.get(key) || 0) + 1);
  }
  return map;
}

function toCountArray(map){
  return Array.from(map.entries())
    .map(function(entry){ return { name: entry[0], count: entry[1] }; })
    .sort(function(a,b){
      if(b.count !== a.count) return b.count - a.count;
      return a.name < b.name ? -1 : (a.name > b.name ? 1 : 0);
    });
}

function getTable(name, defaultHeaders){
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName(name) || ss.insertSheet(name);

  if(sheet.getLastRow() === 0){
    sheet.getRange(1,1,1,defaultHeaders.length).setValues([defaultHeaders]);
  }

  var colCount = sheet.getLastColumn();
  var header = colCount > 0 ? sheet.getRange(1,1,1,colCount).getValues()[0] : [];
  var headerMap = buildHeaderMap(header);

  for(var i=0;i<defaultHeaders.length;i++){
    var key = normalizeKey(defaultHeaders[i]);
    if(headerMap[key] === undefined){
      header.push(defaultHeaders[i]);
      headerMap[key] = header.length - 1;
    }
  }

  if(header.length > colCount){
    sheet.getRange(1,1,1,header.length).setValues([header]);
  }

  return { sheet: sheet, header: header, map: headerMap };
}

function buildHeaderMap(header){
  var map = {};
  for(var i=0;i<header.length;i++){
    var key = normalizeKey(header[i]);
    if(key && map[key] === undefined) map[key] = i;
  }
  return map;
}

function findColumnIndex(table, aliases){
  for(var i=0;i<aliases.length;i++){
    var key = normalizeKey(aliases[i]);
    if(key && table.map[key] !== undefined) return table.map[key];
  }
  return -1;
}

function normalizeKey(value){
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function parseBody(e){
  if(!e || !e.postData || !e.postData.contents) return {};
  return JSON.parse(e.postData.contents);
}

function respondJson(payload){
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(ContentService.MimeType.JSON);
}

function createError(err){
  return { ok: false, error: (err && err.message) ? err.message : String(err) };
}

function sanitizeString(value){
  if(value === null || value === undefined) return '';
  return String(value).trim();
}

function sanitizeCode(value){
  return sanitizeString(value).toUpperCase();
}

function parseTimestamp(value){
  if(value instanceof Date) return value.getTime();
  if(typeof value === 'number' && !isNaN(value)) return value;
  var text = sanitizeString(value);
  if(!text) return Date.now();
  var parsed = Date.parse(text);
  return isNaN(parsed) ? Date.now() : parsed;
}

function getValue(row, index){
  return index >= 0 ? row[index] : '';
}

function setValue(row, index, value){
  if(index >= 0) row[index] = value;
}

function getSpreadsheet(){
  var props = PropertiesService.getScriptProperties();
  var spreadsheetId = props.getProperty('SPREADSHEET_ID');
  if(spreadsheetId){
    try { return SpreadsheetApp.openById(spreadsheetId); }
    catch(_ignored){}
  }
  return SpreadsheetApp.getActive();
}
