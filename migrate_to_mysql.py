import re, shutil

src = r'd:\HOA\HOAManager\server.js'
shutil.copy(src, src + '.sqlite-backup')

with open(src, 'r', encoding='utf-8') as f:
    content = f.read()

# === 1. Add await before db calls and async helper calls ===
DB_FUNCS = ['dbAll', 'dbGet', 'dbRun']
HELPER_FUNCS = [
    'cleanupOrphanedResidentPoolMembers',
    'cleanupFamilyMemberDeletion',
    'upsertRfidCredentialForMember',
    'getPoolMemberHousehold',
    'getPoolMemberStreetAddress',
    'poolMembersHasRfidTagColumn',
    'syncSubscribers',
]
ALL_AWAIT = DB_FUNCS + HELPER_FUNCS

for fn in ALL_AWAIT:
    pa = f'__PA_{fn}__'   # protect async function def
    pd = f'__PD_{fn}__'   # protect function def
    pw = f'__PW_{fn}__'   # protect existing await
    content = re.sub(rf'\basync\s+function\s+{fn}\s*\(', f'{pa}(', content)
    content = re.sub(rf'\bfunction\s+{fn}\s*\(', f'{pd}(', content)
    content = re.sub(rf'\bawait\s+{fn}\s*\(', f'{pw}(', content)
    content = re.sub(rf'\b{fn}\s*\(', f'await {fn}(', content)
    content = content.replace(f'{pa}(', f'async function {fn}(')
    content = content.replace(f'{pd}(', f'function {fn}(')
    content = content.replace(f'{pw}(', f'await {fn}(')

# === 2. Remove saveDb() calls ===
content = re.sub(r'[ \t]*saveDb\(\);[ \t]*\n', '\n', content)
content = content.replace('saveDb();', '')

# === 3. Make sync helper functions async (if not already) ===
MAKE_ASYNC = [
    'getPoolMemberHousehold', 'getPoolMemberStreetAddress',
    'cleanupOrphanedResidentPoolMembers', 'cleanupFamilyMemberDeletion',
    'upsertRfidCredentialForMember', 'poolMembersHasRfidTagColumn',
    'syncSubscribers',
]
for fn in MAKE_ASYNC:
    content = re.sub(rf'(?<!async )function {fn}\(', f'async function {fn}(', content)

# === 4. Make non-async route handler callbacks async ===
content = re.sub(r'(?<!async )\(req,\s*res\)\s*=>', 'async (req, res) =>', content)

# === 5. Fix passport.deserializeUser callback ===
content = content.replace(
    'passport.deserializeUser((id, done) => {',
    'passport.deserializeUser(async (id, done) => {'
)

with open(src, 'w', encoding='utf-8') as f:
    f.write(content)

# Verify
with open(src, 'r', encoding='utf-8') as f:
    c2 = f.read()

bare_dbGet = len([m for m in re.finditer(r'\bdbGet\(', c2) if not c2[max(0,m.start()-6):m.start()].endswith('await ') and not c2[max(0,m.start()-9):m.start()].endswith('function ')])
bare_dbAll = len([m for m in re.finditer(r'\bdbAll\(', c2) if not c2[max(0,m.start()-6):m.start()].endswith('await ') and not c2[max(0,m.start()-9):m.start()].endswith('function ')])
bare_dbRun = len([m for m in re.finditer(r'\bdbRun\(', c2) if not c2[max(0,m.start()-6):m.start()].endswith('await ') and not c2[max(0,m.start()-9):m.start()].endswith('function ')])
savedb_remaining = c2.count('saveDb()')
print(f"Bare dbGet: {bare_dbGet}, dbAll: {bare_dbAll}, dbRun: {bare_dbRun}")
print(f"saveDb remaining: {savedb_remaining}")
print("Done!")
