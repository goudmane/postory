<script setup lang="ts">
type Account = { id: string; email: string; label: string; sent_path: string | null }
type Folder = { path: string; name: string; role: string | null }
type Row = { uid: number; subject: string; from: string; date: string; seen: boolean; starred: boolean }
type Draft = { id: string; revision: number; account_id: string; recipient: string; subject: string; body: string }
const loggedIn = ref(false), needsSetup = ref(false), loading = ref(true)
const email = ref(''), password = ref(''), error = ref('')
const accounts = ref<Account[]>([]), accountId = ref(''), folders = ref<Folder[]>([]), folderPath = ref('INBOX')
const rows = ref<Row[]>([]), selectedUid = ref<number | null>(null), selected = ref<any>(null)
const uidValidity = ref('')
const page = ref(0), hasMore = ref(false), view = ref<'mail'|'accounts'|'activity'|'drafts'>('mail')
const mobileFolders = ref(false), activity = ref<any[]>([])
const composing = ref(false), draft = ref<Draft | null>(null), saveStatus = ref(''), drafts = ref<Draft[]>([])
const config = useRuntimeConfig()
async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(config.public.apiBase + path, { credentials: 'same-origin', ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers } })
  const value = await res.json()
  if (!res.ok) throw new Error(value.message || value.stages?.find((s: any) => !s.ok)?.detail || 'Request failed')
  return value as T
}
async function initialize() {
  loading.value = true
  try {
    await api('/me'); loggedIn.value = true
    accounts.value = await api('/accounts')
    if (accounts.value.length) { accountId.value = accounts.value[0]!.id; await loadFolders() }
  } catch { const status = await api<{needsSetup:boolean}>('/bootstrap-status'); needsSetup.value = status.needsSetup }
  finally { loading.value = false }
}
onMounted(initialize)
async function authenticate() {
  error.value = ''
  try { await api(needsSetup.value ? '/bootstrap' : '/login', { method: 'POST', body: JSON.stringify({ email: email.value, password: password.value }) }); password.value = ''; await initialize() }
  catch (e: any) { error.value = e.message }
}
async function logout() { await api('/logout', { method: 'POST' }); loggedIn.value = false; accounts.value = []; selected.value = null; await initialize() }
async function loadFolders() {
  error.value = ''; selected.value = null; selectedUid.value = null
  try { folders.value = await api(`/accounts/${accountId.value}/folders`); folderPath.value = folders.value.find(f => f.role === '\\Inbox')?.path || 'INBOX'; await loadMessages() }
  catch(e:any) { error.value = e.message }
}
async function loadMessages() {
  error.value = ''; selected.value = null; selectedUid.value = null; page.value = 0
  try { const data = await api<{items:Row[];hasMore:boolean;uidValidity:string}>(`/accounts/${accountId.value}/messages?path=${encodeURIComponent(folderPath.value)}&page=0`); rows.value = data.items; hasMore.value = data.hasMore; uidValidity.value = data.uidValidity }
  catch(e:any) { error.value = e.message }
}
async function more() {
  const next = page.value + 1
  const data = await api<{items:Row[];hasMore:boolean;uidValidity:string}>(`/accounts/${accountId.value}/messages?path=${encodeURIComponent(folderPath.value)}&page=${next}`)
  if (data.uidValidity !== uidValidity.value) { error.value = 'The folder changed on the server. Refresh it before loading more.'; return }
  page.value = next; rows.value.push(...data.items); hasMore.value = data.hasMore
}
async function open(row: Row) {
  selectedUid.value = row.uid; selected.value = null; error.value = ''
  try { selected.value = await api(`/accounts/${accountId.value}/messages/${row.uid}?path=${encodeURIComponent(folderPath.value)}&uidValidity=${encodeURIComponent(uidValidity.value)}`) }
  catch(e:any) { error.value = e.message }
}
async function flag(row: Row, name: '\\Seen'|'\\Flagged', enabled: boolean) {
  try { await api(`/accounts/${accountId.value}/messages/${row.uid}/flag`, { method: 'POST', body: JSON.stringify({ path: folderPath.value, uidValidity: uidValidity.value, flag: name, enabled }) }); row[name === '\\Seen' ? 'seen' : 'starred'] = enabled }
  catch(e:any) { error.value = e.message }
}
const setup = reactive({ label: '', email: '', username: '', password: '', imapHost: '', imapPort: 993, imapSecure: true, smtpHost: '', smtpPort: 465, smtpSecure: true })
async function addAccount() {
  error.value = ''; saveStatus.value = 'Testing mail servers…'
  try { const item = await api<Account>('/accounts', { method: 'POST', body: JSON.stringify(setup) }); accounts.value.push(item); accountId.value = item.id; setup.password = ''; view.value = 'mail'; saveStatus.value = ''; await loadFolders() }
  catch(e:any) { error.value = e.message; saveStatus.value = '' }
}
async function newDraft(existing?: Draft) {
  error.value = ''
  try {
    draft.value = existing || await api<Draft>('/drafts', { method: 'POST', body: JSON.stringify({ accountId: accountId.value, recipient: '', subject: '', body: '' }) })
    composing.value = true; saveStatus.value = 'Saved'
  } catch(e:any) { error.value = e.message }
}
let saveTimer: ReturnType<typeof setTimeout> | undefined
function changed() { saveStatus.value = 'Unsaved'; clearTimeout(saveTimer); saveTimer = setTimeout(saveDraft, 650) }
let saveInFlight: Promise<void> | null = null
async function saveDraft() {
  if (!draft.value) return
  if (saveInFlight) { await saveInFlight; if (saveStatus.value === 'Unsaved') return saveDraft(); return }
  const current = draft.value
  const snapshot = { recipient: current.recipient, subject: current.subject, body: current.body, revision: current.revision }
  saveStatus.value = 'Saving…'
  saveInFlight = (async () => {
    try {
      const saved = await api<Draft>(`/drafts/${current.id}`, { method: 'PATCH', body: JSON.stringify(snapshot) })
      if (draft.value?.id === saved.id) {
        draft.value.revision = saved.revision
        saveStatus.value = draft.value.recipient === snapshot.recipient && draft.value.subject === snapshot.subject && draft.value.body === snapshot.body ? 'Saved' : 'Unsaved'
      }
    } catch(e:any) { saveStatus.value = 'Save failed'; error.value = e.message }
  })()
  await saveInFlight
  saveInFlight = null
  if (saveStatus.value === 'Unsaved') return saveDraft()
}
async function closeComposer() {
  clearTimeout(saveTimer); await saveDraft()
  if (saveStatus.value === 'Saved') composing.value = false
}
async function sendDraft() {
  clearTimeout(saveTimer); await saveDraft(); if (saveStatus.value !== 'Saved' || !draft.value) return
  try { saveStatus.value = 'Sending…'; const result = await api<{status:string}>(`/drafts/${draft.value.id}/send`, { method: 'POST' });
    saveStatus.value = result.status === 'accepted_sent_copy_pending' ? 'Accepted by SMTP; Sent copy pending' : result.status
    composing.value = false; view.value = 'activity'; await loadActivity() }
  catch(e:any) { saveStatus.value = 'Send uncertain — check Activity before retrying'; error.value = e.message }
}
async function loadActivity() { activity.value = await api('/activity/smtp'); view.value = 'activity' }
async function reconcileSent(event: any) {
  try { const result = await api<{status:string}>(`/sends/${event.id}/reconcile-sent`, { method: 'POST' }); event.status = result.status; event.detail = result.status === 'filed' ? 'Copy present in Sent' : 'Set a Sent folder on this account' }
  catch(e:any) { error.value = e.message }
}
async function loadDrafts() { drafts.value = await api('/drafts'); view.value = 'drafts' }
function date(value: string) { return value ? new Date(value).toLocaleString() : '' }
</script>

<template>
  <div class="app">
    <header class="topbar"><div class="brand">✉ Mailroom <span class="status">early build</span></div>
      <div class="top-actions" v-if="loggedIn"><span class="status">{{ accounts.length }} account{{ accounts.length === 1 ? '' : 's' }}</span><button class="btn ghost small" @click="logout">Sign out</button></div>
    </header>
    <main v-if="loading" class="panel" aria-live="polite">Opening Mailroom…</main>
    <main v-else-if="!loggedIn" class="panel">
      <h1>{{ needsSetup ? 'Create the owner account' : 'Welcome back' }}</h1><p class="muted">{{ needsSetup ? 'This login protects all connected mailboxes.' : 'Sign in to your mail workspace.' }}</p>
      <form @submit.prevent="authenticate"><div class="field"><label for="login-email">Email</label><input id="login-email" v-model="email" type="email" required autocomplete="username"></div>
        <div class="field"><label for="login-password">Password</label><input id="login-password" v-model="password" type="password" required :minlength="needsSetup ? 12 : 1" autocomplete="current-password"></div>
        <p v-if="error" class="error" role="alert">{{ error }}</p><button class="btn">{{ needsSetup ? 'Create account' : 'Sign in' }}</button></form>
    </main>
    <template v-else>
      <div v-if="view === 'accounts'" class="panel"><h1>Add a mail account</h1><p class="muted">Enter the settings from your provider. TLS is required. This build supports password or app password accounts.</p>
        <form @submit.prevent="addAccount"><div class="field"><label>Display name<input v-model="setup.label" required placeholder="Work"></label></div>
          <div class="field"><label>Email<input v-model="setup.email" type="email" required placeholder="you@example.com"></label></div>
          <div class="field"><label>IMAP / SMTP username<input v-model="setup.username" required placeholder="you@example.com"></label></div>
          <div class="field"><label>Password or app password<input v-model="setup.password" type="password" required></label></div>
          <div class="grid grid-cols-2 gap-3"><div class="field"><label>IMAP host<input v-model="setup.imapHost" required placeholder="imap.example.com"></label></div><div class="field"><label>IMAP port<input v-model.number="setup.imapPort" type="number" required></label></div>
            <div class="field"><label>SMTP host<input v-model="setup.smtpHost" required placeholder="smtp.example.com"></label></div><div class="field"><label>SMTP port<input v-model.number="setup.smtpPort" type="number" required></label></div></div>
          <div class="flex gap-5 mb-5"><label><input v-model="setup.imapSecure" type="checkbox"> IMAP implicit TLS</label><label><input v-model="setup.smtpSecure" type="checkbox"> SMTP implicit TLS</label></div>
          <p v-if="error" class="error" role="alert">{{ error }}</p><button class="btn" :disabled="!!saveStatus">Connect account</button> <button type="button" class="btn ghost" @click="view='mail'">Cancel</button> <span aria-live="polite">{{ saveStatus }}</span></form>
      </div>
      <div v-else-if="view === 'activity'" class="panel"><button class="btn ghost" @click="view='mail'">← Mail</button><h1>SMTP activity</h1>
        <p class="muted">Only messages sent through this app appear here. SMTP acceptance does not confirm delivery.</p>
        <p v-if="error" class="error" role="alert">{{ error }}</p><p v-if="!activity.length">No activity yet.</p><div v-for="event in activity" :key="event.id" class="py-4 border-b border-slate-200"><strong>{{ event.subject || '(No subject)' }}</strong> → {{ event.recipient }}<br><span class="status">{{ date(event.created_at) }} · {{ event.status }} · {{ event.detail }}</span><br><button v-if="['accepted_sent_copy_pending','filing_uncertain','accepted_no_sent_folder'].includes(event.status)" class="btn secondary small mt-2" @click="reconcileSent(event)">Check / save Sent copy</button></div>
      </div>
      <div v-else-if="view === 'drafts'" class="panel"><button class="btn ghost" @click="view='mail'">← Mail</button><h1>Drafts</h1><p v-if="!drafts.length">No drafts yet.</p>
        <button v-for="item in drafts" :key="item.id" class="nav-row" @click="newDraft(item)">{{ item.subject || '(No subject)' }} · {{ item.recipient || 'No recipient' }}</button>
      </div>
      <div v-else-if="!accounts.length" class="panel"><h1>Bring your inbox here</h1><p class="muted">Connect your IMAP and SMTP account to begin.</p><button class="btn" @click="view='accounts'">Add mail account</button></div>
      <div v-else class="workspace">
        <nav class="rail" :class="{ 'max-sm:hidden': !mobileFolders }" aria-label="Mail folders">
          <button class="btn w-full" @click="newDraft()">Compose</button>
          <div class="section-title">Account</div><select v-model="accountId" class="w-full p-2 border rounded" aria-label="Current account" @change="loadFolders"><option v-for="a in accounts" :key="a.id" :value="a.id">{{ a.label }} · {{ a.email }}</option></select>
          <div class="section-title">Folders</div><button v-for="folder in folders" :key="folder.path" class="nav-row" :class="{selected: folderPath === folder.path}" @click="folderPath=folder.path; mobileFolders=false; loadMessages()">{{ folder.name }}</button>
          <div class="section-title">Tools</div><button class="nav-row" @click="loadDrafts">Drafts</button><button class="nav-row" @click="loadActivity">SMTP activity</button><button class="nav-row" @click="view='accounts'">Add account</button>
        </nav>
        <section class="list" aria-label="Message list"><div class="list-header"><div class="flex justify-between items-center"><button class="btn ghost small sm:hidden" @click="mobileFolders=true">☰ Folders</button><h1>{{ folderPath }}</h1><button class="btn ghost small" @click="loadMessages">Refresh</button></div><p class="status mt-2">Live IMAP view · refresh to check for new mail</p></div>
          <p v-if="error" class="error" role="alert">{{ error }}</p><p v-if="!rows.length" class="p-5 muted">No messages here, or this folder has not loaded yet.</p>
          <button v-for="row in rows" :key="row.uid" class="message-row" :class="{selected: selectedUid === row.uid, unread: !row.seen}" @click="open(row)"><small>{{ date(row.date) }}</small><span>{{ row.from || 'Unknown sender' }}</span><span class="subject">{{ row.starred ? '★ ' : '' }}{{ row.subject }}</span></button>
          <button v-if="hasMore" class="btn ghost m-4" @click="more">Load older messages</button>
        </section>
        <section v-if="selectedUid !== null" class="viewer" aria-label="Message"><button class="btn ghost small lg:hidden" @click="selectedUid=null; selected=null">← Inbox</button><p v-if="!selected">Loading message…</p>
          <template v-else><h2>{{ selected.subject }}</h2><div class="viewer-meta">From: {{ selected.from }}<br>To: {{ selected.to }}<br>{{ date(selected.date) }}</div>
            <div class="flex gap-2 mb-6"><button class="btn secondary small" @click="newDraft()">New message</button><button class="btn ghost small" @click="flag(rows.find(r=>r.uid===selectedUid)!, '\\Seen', true)">Mark read</button><button class="btn ghost small" @click="flag(rows.find(r=>r.uid===selectedUid)!, '\\Flagged', true)">Star</button></div>
            <div class="message-body">{{ selected.text }}</div><p v-if="selected.attachments?.length" class="muted mt-6">{{ selected.attachments.length }} attachment(s) detected. Download support is not available in this build.</p></template>
        </section><section v-else class="viewer muted"><h2>Your mail, clearly.</h2><p>Select a message to read it.</p></section>
      </div>
      <section v-if="composing && draft" class="composer" aria-label="Compose message"><header><strong>New message · {{ accounts.find(a=>a.id===draft?.account_id)?.email }}</strong><button class="btn ghost small" aria-label="Close composer after saving draft" @click="closeComposer">✕</button></header>
        <main><div class="field"><label>To<input v-model="draft.recipient" type="email" @input="changed"></label></div><div class="field"><label>Subject<input v-model="draft.subject" @input="changed"></label></div><div class="field"><label>Message<textarea v-model="draft.body" @input="changed"></textarea></label></div><p v-if="error" class="error" role="alert">{{ error }}</p></main>
        <footer><button class="btn" :disabled="saveStatus==='Sending…' || saveStatus==='Save failed'" @click="sendDraft">Send</button><span class="status" aria-live="polite">{{ saveStatus }}</span></footer>
      </section>
    </template>
  </div>
</template>
