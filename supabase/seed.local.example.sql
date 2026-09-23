-- Copiá este archivo a supabase/seed.local.sql (ignorado por git) y poné tu mail.
-- Se aplica después de seed.sql en cada `pnpm db:reset`. Solo desarrollo local.
-- Contraseña: anotado123

do $$
declare
  v_email text := 'tu-mail@ejemplo.com';
  v_id uuid := gen_random_uuid();
begin
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change,
    email_change_token_current, phone_change, phone_change_token, reauthentication_token
  ) values (
    '00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated', v_email,
    extensions.crypt('anotado123', extensions.gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}', '{}', now(), now(),
    '', '', '', '', '', '', '', ''
  );
  insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (v_id::text, v_id, jsonb_build_object('sub', v_id::text, 'email', v_email, 'email_verified', true),
          'email', now(), now(), now());

  -- Dueño de Rotisería El Ceibo.
  insert into public.miembros (negocio_id, user_id, rol)
  values ('a0000000-0000-4000-8000-000000000001', v_id, 'dueno');
end;
$$;
