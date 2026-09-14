require("dotenv").config();
const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch");

const app = express();
const PORT = process.env.PORT || 3000;
const REPORT_ID = process.env.RUTERO_REPORT_ID || "119";
const API_TOKEN =
  process.env.RUTERO_API_TOKEN ||
  "Token 9b7661d9292aab2c339b95bf251063791c2a62ff";
const BASE_URL = `https://botai.smartdataautomation.com/api_backend_ai/dinamic-db/report/${REPORT_ID}`;

const AUTH_HEADERS = {
  Authorization: API_TOKEN,
  "Content-Type": "application/json",
};

app.use(cors({ origin: process.env.CORS_ORIGIN || "*" }));
app.use(express.json());

function normalizar(texto) {
  return String(texto ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

// El reporte destino usa "5/09/2026" (dia sin cero, mes con cero) en vez de ISO
function formatearFecha(fechaISO) {
  const [anio, mes, dia] = String(fechaISO).split("-");
  if (!anio || !mes || !dia) return fechaISO;
  return `${parseInt(dia, 10)}/${mes}/${anio}`;
}

async function fetchReporte(tabla, params = {}) {
  const url = new URL(`${BASE_URL}/${tabla}`);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, value);
    }
  });

  const response = await fetch(url.toString(), { headers: AUTH_HEADERS });
  if (!response.ok) {
    const text = await response.text();
    const error = new Error(
      `Error ${response.status} consultando ${tabla}: ${text.substring(0, 300)}`
    );
    error.status = response.status;
    throw error;
  }
  return response.json();
}

async function crearRegistro(tabla, data) {
  const response = await fetch(`${BASE_URL}/${tabla}`, {
    method: "POST",
    headers: AUTH_HEADERS,
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    const text = await response.text();
    const error = new Error(
      `Error ${response.status} creando registro en ${tabla}: ${text.substring(0, 300)}`
    );
    error.status = response.status;
    throw error;
  }
  return response.json();
}

// pdv_nutresa no soporta busqueda por palabra clave ni paginacion en el origen
// (~5.8k registros, ~1.7MB de una sola vez), por eso se cachea en memoria.
let pdvCache = { data: [], fetchedAt: 0 };
const PDV_CACHE_TTL_MS = 5 * 60 * 1000;

async function obtenerPdvs({ forzar = false } = {}) {
  const ahora = Date.now();
  if (!forzar && pdvCache.data.length && ahora - pdvCache.fetchedAt < PDV_CACHE_TTL_MS) {
    return pdvCache.data;
  }
  const json = await fetchReporte("pdv_nutresa");
  pdvCache = { data: json.result || [], fetchedAt: ahora };
  return pdvCache.data;
}

async function buscarLasPorCedula(cedula) {
  const json = await fetchReporte("usuarios_nutresa", { CEDULA: String(cedula).trim() });
  return (json.result || [])[0] || null;
}

app.get("/health", (req, res) => res.json({ status: "ok" }));

// 1) Login por cedula: solo puede continuar el personal con cargo LAS
app.get("/api/usuarios/login", async (req, res) => {
  const cedula = String(req.query.cedula || "").trim();
  if (!cedula) {
    return res.status(400).json({ authorized: false, message: "Debes indicar la cedula" });
  }

  try {
    const usuario = await buscarLasPorCedula(cedula);

    if (!usuario) {
      return res.status(404).json({ authorized: false, message: "Cedula no encontrada" });
    }

    if (normalizar(usuario.CARGO) !== "las") {
      return res.status(403).json({
        authorized: false,
        message: "Solo el personal con cargo LAS puede registrar el rutero",
      });
    }

    return res.json({
      authorized: true,
      cedula: usuario.CEDULA,
      nombre: usuario.NOMBRE,
      ciudad: usuario.CIUDAD,
    });
  } catch (err) {
    console.error("Error en /api/usuarios/login:", err);
    return res
      .status(err.status || 500)
      .json({ authorized: false, message: "Error consultando usuarios", details: err.message });
  }
});

// 2) Buscador de PDV por palabra clave (SAP, PDV, ciudad, direccion, regional, canal)
app.get("/api/pdv/buscar", async (req, res) => {
  const termino = normalizar(req.query.q);
  const limite = Math.min(parseInt(req.query.limit, 10) || 30, 100);

  if (!termino) {
    return res.json({ result: [], total: 0 });
  }

  try {
    const pdvs = await obtenerPdvs();
    const coincidencias = pdvs.filter((pdv) =>
      [pdv.SAP, pdv.PDV, pdv.CIUDAD, pdv.DIRECCION, pdv.REGIONAL, pdv.CANAL].some((campo) =>
        normalizar(campo).includes(termino)
      )
    );

    const resultado = coincidencias.slice(0, limite).map((pdv) => ({
      sap: pdv.SAP,
      pdv: pdv.PDV,
      regional: pdv.REGIONAL,
      ciudad: pdv.CIUDAD,
      direccion: pdv.DIRECCION,
      canal: pdv.CANAL,
    }));

    return res.json({ result: resultado, total: coincidencias.length });
  } catch (err) {
    console.error("Error en /api/pdv/buscar:", err);
    return res.status(err.status || 500).json({ error: "Error buscando PDV", details: err.message });
  }
});

// Fuerza refresco manual de la cache de PDV (por si cargan puntos nuevos en el origen)
app.post("/api/pdv/refrescar-cache", async (req, res) => {
  try {
    const pdvs = await obtenerPdvs({ forzar: true });
    return res.json({ status: "ok", total: pdvs.length });
  } catch (err) {
    return res.status(err.status || 500).json({ error: "Error refrescando cache", details: err.message });
  }
});

// 3) Registrar visitas: una fecha seleccionada = un registro independiente.
// La cedula del LAS se revalida aqui (no se confia en el nombre que mande el frontend)
// porque el proxy queda publico y cualquiera podria llamarlo directo.
app.post("/api/rutero/registrar", async (req, res) => {
  const { sap, pdv, regional, ciudad, direccion, canal, fechas, lasCedula, estado, estadoVisita } =
    req.body || {};

  if (!sap || !pdv) {
    return res.status(400).json({ error: "Faltan datos del PDV (sap, pdv)" });
  }
  if (!lasCedula) {
    return res.status(400).json({ error: "Falta la cedula del LAS" });
  }
  if (!Array.isArray(fechas) || fechas.length === 0) {
    return res.status(400).json({ error: "Debes indicar al menos una fecha de visita" });
  }

  let las;
  try {
    las = await buscarLasPorCedula(lasCedula);
  } catch (err) {
    return res.status(err.status || 500).json({ error: "Error validando el LAS", details: err.message });
  }

  if (!las || normalizar(las.CARGO) !== "las") {
    return res.status(403).json({ error: "La cedula indicada no corresponde a un LAS activo" });
  }

  const creados = [];
  const errores = [];

  for (const fechaISO of fechas) {
    const registro = {
      SAP: sap,
      PDV: pdv,
      REGIONAL: regional,
      CIUDAD: ciudad,
      DIRECCION: direccion,
      CANAL: canal,
      FECHA_VISITA: formatearFecha(fechaISO),
      ESTADO: estado || "PDT VISITA",
      LAS: las.NOMBRE,
      LAS_CEDULA: las.CEDULA,
      ESTADO_DE_LA_VISITA: estadoVisita || "PROGRAMACION",
    };

    try {
      const respuesta = await crearRegistro("rutero_registros_pagina_nutresa", registro);
      creados.push({ fecha: fechaISO, respuesta });
    } catch (err) {
      console.error(`Error creando registro para ${fechaISO}:`, err);
      errores.push({ fecha: fechaISO, error: err.message });
    }
  }

  const status = errores.length === 0 ? 200 : creados.length > 0 ? 207 : 500;
  return res.status(status).json({ creados, errores });
});

app.listen(PORT, () => {
  console.log(`Servidor proxy Nutresa escuchando en http://localhost:${PORT}`);
});
