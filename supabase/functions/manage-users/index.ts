import { withSupabase } from "npm:@supabase/server";
import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const COMPANY_DOMAIN = "7cantos.com";
const ROLES = ["hunter", "admin"];
const LOWER = "abcdefghijkmnopqrstuvwxyz";
const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const DIGIT = "23456789";
const SYMBOL = "!@#$%&*?";

function pick(alphabet: string) {
  const buffer = new Uint32Array(1);
  crypto.getRandomValues(buffer);
  return alphabet[buffer[0] % alphabet.length];
}

// 16 caracteres com as quatro classes garantidas — a mesma política que auth.js exige do usuário.
function temporaryPassword() {
  const required = [pick(LOWER), pick(UPPER), pick(DIGIT), pick(SYMBOL)];
  const pool = LOWER + UPPER + DIGIT + SYMBOL;
  while (required.length < 16) required.push(pick(pool));
  for (let index = required.length - 1; index > 0; index -= 1) {
    const buffer = new Uint32Array(1);
    crypto.getRandomValues(buffer);
    const swap = buffer[0] % (index + 1);
    [required[index], required[swap]] = [required[swap], required[index]];
  }
  return required.join("");
}

function normalizeEmail(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

function isCompanyEmail(email: string) {
  return email.endsWith("@" + COMPANY_DOMAIN) && email.length > COMPANY_DOMAIN.length + 1;
}

function serviceClient() {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("Service role não configurada nesta função.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

type AuthUser = {
  id: string;
  email?: string | null;
  created_at?: string;
  last_sign_in_at?: string | null;
  app_metadata?: Record<string, unknown>;
  user_metadata?: Record<string, unknown>;
};

function publicUser(user: AuthUser) {
  return {
    id: user.id,
    email: user.email ?? null,
    role: (user.app_metadata?.role as string) ?? null,
    created_at: user.created_at ?? null,
    last_sign_in_at: user.last_sign_in_at ?? null,
    must_change_password: user.user_metadata?.must_change_password === true,
  };
}

const handler = withSupabase({ auth: "user" }, async (request, ctx) => {
  const { data: authData, error: authError } = await ctx.supabase.auth.getUser();
  const caller = authData.user;
  if (authError || !caller || caller.app_metadata?.role !== "admin") {
    return Response.json({ error: "Apenas admin pode gerenciar usuários." }, { status: 403, headers: CORS });
  }
  if (!isCompanyEmail(normalizeEmail(caller.email))) {
    return Response.json({ error: "Conta fora do domínio corporativo." }, { status: 403, headers: CORS });
  }

  let body: Record<string, unknown> = {};
  try {
    body = await request.json();
  } catch (_error) {
    return Response.json({ error: "Corpo inválido." }, { status: 400, headers: CORS });
  }
  const action = String(body.action ?? "list");
  const admin = serviceClient();

  if (action === "list") {
    const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
    if (error) return Response.json({ error: error.message }, { status: 502, headers: CORS });
    const users = (data.users as AuthUser[])
      .map(publicUser)
      .filter((user) => user.email && isCompanyEmail(user.email))
      .sort((a, b) => String(a.email).localeCompare(String(b.email), "pt-BR"));
    return Response.json({ users }, { headers: CORS });
  }

  if (action === "create") {
    const email = normalizeEmail(body.email);
    const role = String(body.role ?? "hunter");
    if (!isCompanyEmail(email)) {
      return Response.json({ error: "Use um e-mail @7cantos.com." }, { status: 400, headers: CORS });
    }
    if (!ROLES.includes(role)) {
      return Response.json({ error: "Papel inválido." }, { status: 400, headers: CORS });
    }
    const password = temporaryPassword();
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      app_metadata: { role },
      user_metadata: { must_change_password: true },
    });
    if (error) {
      const conflict = /already|exists|registered/i.test(error.message);
      return Response.json(
        { error: conflict ? "Já existe um usuário com este e-mail." : error.message },
        { status: conflict ? 409 : 502, headers: CORS },
      );
    }
    // A senha temporária volta uma única vez. Não fica gravada em lugar nenhum.
    return Response.json(
      { user: publicUser(data.user as AuthUser), temporary_password: password },
      { headers: CORS },
    );
  }

  return Response.json({ error: "Ação não suportada." }, { status: 400, headers: CORS });
});

export default {
  fetch(request: Request) {
    if (request.method === "OPTIONS") return new Response("ok", { headers: CORS });
    if (request.method !== "POST") {
      return Response.json({ error: "Método não permitido." }, { status: 405, headers: CORS });
    }
    return handler(request);
  },
};
