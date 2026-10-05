import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "GET") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) throw new Error("Supabase server configuration is missing");

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: mixes, error: mixError } = await supabase
      .from("deere_tank_mixes")
      .select("id,deere_tank_mix_id,name,solution_rate,solution_rate_unit,tank_volume,tank_volume_unit,material_classification,notes,target_crops,archived,deere_modified_at")
      .eq("archived", false)
      .order("name", { ascending: true });

    if (mixError) throw mixError;

    const mixIds = (mixes ?? []).map((m) => m.id);
    let components: any[] = [];

    if (mixIds.length) {
      const { data, error } = await supabase
        .from("deere_tank_mix_components")
        .select("id,tank_mix_id,component_order,role,deere_product_id,product_type,product_id,product_name,rate,rate_unit,resolution_status,product_uri")
        .in("tank_mix_id", mixIds)
        .order("component_order", { ascending: true });
      if (error) throw error;
      components = data ?? [];
    }

    const byMix = new Map<string, any[]>();
    for (const component of components) {
      const arr = byMix.get(component.tank_mix_id) ?? [];
      arr.push(component);
      byMix.set(component.tank_mix_id, arr);
    }

    const tankMixes = (mixes ?? []).map((mix) => ({
      ...mix,
      components: byMix.get(mix.id) ?? [],
    }));

    return new Response(JSON.stringify({
      tankMixes,
      count: tankMixes.length,
      generatedAt: new Date().toISOString(),
    }), {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : String(error),
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
