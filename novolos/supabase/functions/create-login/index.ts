// Supabase Edge Function: create-login
// Lets an admin create a login (the employee's email + a temporary password) for an
// employee who has none yet. It runs on Supabase's servers, so the secret key that
// can create users never reaches the browser.
//
// Deploy: Supabase Dashboard → Edge Functions → Deploy a new function → name "create-login",
// paste this file. Or with the CLI: supabase functions deploy create-login
import { createClient } from 'npm:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

// Works with the legacy service_role key and with the newer secret keys.
function secretKey(): string {
  const legacy = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (legacy) return legacy
  const keys = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}') as Record<string, string>
  const first = Object.values(keys)[0]
  if (!first) throw new Error('No secret key is available to the function.')
  return first
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const reply = (body: Record<string, unknown>, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

  try {
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, secretKey(), {
      auth: { persistSession: false, autoRefreshToken: false },
    })

    // 1. Who is calling? Their own login token comes in the Authorization header.
    const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
    const { data: caller, error: userErr } = await admin.auth.getUser(token)
    if (userErr || !caller.user) return reply({ error: 'You are not signed in.' }, 401)

    // 2. Only an active admin may create logins.
    const { data: me } = await admin
      .from('employee').select('id, app_role(role)')
      .eq('auth_user_id', caller.user.id).eq('active', true).maybeSingle()
    const myRoles = ((me?.app_role ?? []) as { role: string }[]).map((r) => r.role)
    if (!myRoles.includes('admin')) return reply({ error: 'Only admins can create logins.' }, 403)

    // 3. Check the request and the employee.
    const { employee_id, password } = await req.json()
    if (typeof password !== 'string' || password.length < 8) {
      return reply({ error: 'The temporary password must be at least 8 characters.' }, 400)
    }
    const { data: emp } = await admin
      .from('employee').select('id, full_name, email, active, auth_user_id')
      .eq('id', employee_id).maybeSingle()
    if (!emp) return reply({ error: 'Employee not found.' }, 404)
    if (!emp.active) return reply({ error: `${emp.full_name} is inactive. Activate them first.` }, 400)
    if (!emp.email) return reply({ error: `${emp.full_name} has no email. Add one first (e.g. via HRIS import).` }, 400)
    if (emp.auth_user_id) return reply({ error: `${emp.full_name} already has a login.` }, 409)

    // 4. Create the login, already confirmed. The flag is for a future "change password" screen.
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email: emp.email,
      password,
      email_confirm: true,
      user_metadata: { must_change_password: true },
    })
    if (createErr || !created.user) {
      return reply({ error: createErr?.message ?? 'Could not create the login.' }, 400)
    }

    // 5. Link it to the employee. The trigger from 0002 normally does this already;
    //    doing it here too covers e.g. different capitals in the email.
    const { error: linkErr } = await admin.from('employee').update({ auth_user_id: created.user.id }).eq('id', emp.id)
    if (linkErr) return reply({ error: `Login created, but linking failed: ${linkErr.message}` }, 500)

    return reply({ ok: true, email: emp.email })
  } catch (e) {
    return reply({ error: e instanceof Error ? e.message : String(e) }, 500)
  }
})
