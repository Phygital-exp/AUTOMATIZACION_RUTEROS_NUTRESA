const STORAGE_KEY = "nutresa_las_usuario";
const MAX_FILAS_MASIVO = 500;

const estado = {
  usuario: null, // { nombre, cedula, ciudad }
  pdvSeleccionado: null, // { sap, pdv, regional, ciudad, direccion, canal }
  fechasSeleccionadas: [], // ["2026-09-05", ...]
};

let gruposMasivoValidos = []; // [{ sap, pdv, regional, ciudad, direccion, canal, fechas: [...] }]

const el = {
  usuarioInfo: document.getElementById("usuarioInfo"),
  usuarioNombre: document.getElementById("usuarioNombre"),
  btnLogout: document.getElementById("btnLogout"),

  pantallaLogin: document.getElementById("pantallaLogin"),
  formLogin: document.getElementById("formLogin"),
  inputCedula: document.getElementById("inputCedula"),
  btnLogin: document.getElementById("btnLogin"),
  mensajeLogin: document.getElementById("mensajeLogin"),

  pantallaModo: document.getElementById("pantallaModo"),
  btnModoIndividual: document.getElementById("btnModoIndividual"),
  btnModoMasivo: document.getElementById("btnModoMasivo"),

  pantallaBuscarPdv: document.getElementById("pantallaBuscarPdv"),
  btnVolverModoDesdeBuscar: document.getElementById("btnVolverModoDesdeBuscar"),
  inputBuscarPdv: document.getElementById("inputBuscarPdv"),
  spinnerPdv: document.getElementById("spinnerPdv"),
  resultadosPdv: document.getElementById("resultadosPdv"),
  mensajeBuscarPdv: document.getElementById("mensajeBuscarPdv"),

  pantallaFechas: document.getElementById("pantallaFechas"),
  resumenPdv: document.getElementById("resumenPdv"),
  btnCambiarPdv: document.getElementById("btnCambiarPdv"),
  calendarioFechas: document.getElementById("calendarioFechas"),
  resumenFechas: document.getElementById("resumenFechas"),
  btnRegistrar: document.getElementById("btnRegistrar"),
  mensajeRegistrar: document.getElementById("mensajeRegistrar"),

  pantallaMasivo: document.getElementById("pantallaMasivo"),
  btnVolverModoDesdeMasivo: document.getElementById("btnVolverModoDesdeMasivo"),
  btnDescargarPlantilla: document.getElementById("btnDescargarPlantilla"),
  inputArchivoMasivo: document.getElementById("inputArchivoMasivo"),
  spinnerMasivo: document.getElementById("spinnerMasivo"),
  mensajeMasivo: document.getElementById("mensajeMasivo"),
  listaErroresMasivo: document.getElementById("listaErroresMasivo"),
  cardResumenMasivo: document.getElementById("cardResumenMasivo"),
  filasResumenMasivo: document.getElementById("filasResumenMasivo"),
  btnRegistrarMasivo: document.getElementById("btnRegistrarMasivo"),

  pantallaConfirmacion: document.getElementById("pantallaConfirmacion"),
  mensajeConfirmacion: document.getElementById("mensajeConfirmacion"),
  listaErrores: document.getElementById("listaErrores"),
  cardReporte: document.getElementById("cardReporte"),
  filasReporte: document.getElementById("filasReporte"),
  btnVolverInicio: document.getElementById("btnVolverInicio"),
};

let calendarioInstancia = null;
let temporizadorBusqueda = null;

function mostrarPantalla(idPantalla) {
  document.querySelectorAll(".pantalla").forEach((p) => p.classList.remove("activa"));
  document.getElementById(idPantalla).classList.add("activa");
}

function mostrarMensaje(elemento, texto, tipo) {
  elemento.textContent = texto;
  elemento.className = "mensaje " + tipo;
  elemento.hidden = false;
}

function ocultarMensaje(elemento) {
  elemento.hidden = true;
}

function formatearFechaISO(fecha) {
  const anio = fecha.getFullYear();
  const mes = String(fecha.getMonth() + 1).padStart(2, "0");
  const dia = String(fecha.getDate()).padStart(2, "0");
  return `${anio}-${mes}-${dia}`;
}

// Igual al formato que usa el backend al guardar (FECHA_VISITA: "5/09/2026")
function formatearFechaVisita(fechaISO) {
  const [anio, mes, dia] = fechaISO.split("-");
  return `${parseInt(dia, 10)}/${mes}/${anio}`;
}

async function apiFetch(ruta, opciones = {}) {
  const respuesta = await fetch(`${API_BASE_URL}${ruta}`, {
    headers: { "Content-Type": "application/json" },
    ...opciones,
  });
  const datos = await respuesta.json().catch(() => ({}));
  if (!respuesta.ok) {
    const error = new Error(datos.message || datos.error || `Error ${respuesta.status}`);
    error.status = respuesta.status;
    error.datos = datos;
    throw error;
  }
  return datos;
}

// Llama al proxy y devuelve las filas creadas/fallidas ya con los datos del PDV pegados,
// para poder armar un reporte comun sin importar si viene del cargue individual o masivo.
async function enviarRegistroPdv(pdv, fechas) {
  const datos = await apiFetch("/api/rutero/registrar", {
    method: "POST",
    body: JSON.stringify({
      sap: pdv.sap,
      pdv: pdv.pdv,
      regional: pdv.regional,
      ciudad: pdv.ciudad,
      direccion: pdv.direccion,
      canal: pdv.canal,
      fechas,
      lasCedula: estado.usuario.cedula,
    }),
  });

  const filasOk = (datos.creados || []).map((r) => ({ ...pdv, fecha: r.fecha }));
  const fallos = (datos.errores || []).map((r) => ({ ...pdv, fecha: r.fecha, error: r.error }));
  return { filasOk, fallos };
}

async function buscarPdvPorSap(sap) {
  const datos = await apiFetch(`/api/pdv/buscar?q=${encodeURIComponent(sap)}&limit=15`);
  return (datos.result || []).find((p) => String(p.sap) === String(sap)) || null;
}

// ---------- sesion ----------

function cargarSesion() {
  const guardado = sessionStorage.getItem(STORAGE_KEY);
  if (!guardado) return;
  try {
    estado.usuario = JSON.parse(guardado);
    mostrarSesionActiva();
    mostrarPantalla("pantallaModo");
  } catch {
    sessionStorage.removeItem(STORAGE_KEY);
  }
}

function guardarSesion() {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(estado.usuario));
}

function mostrarSesionActiva() {
  el.usuarioNombre.textContent = estado.usuario.nombre;
  el.usuarioInfo.hidden = false;
}

function cerrarSesion() {
  sessionStorage.removeItem(STORAGE_KEY);
  estado.usuario = null;
  el.usuarioInfo.hidden = true;
  el.inputCedula.value = "";
  reiniciarFlujoIndividual();
  reiniciarFlujoMasivo();
  mostrarPantalla("pantallaLogin");
}

// ---------- pantalla 1: login ----------

el.formLogin.addEventListener("submit", async (evento) => {
  evento.preventDefault();
  const cedula = el.inputCedula.value.trim();
  if (!cedula) return;

  ocultarMensaje(el.mensajeLogin);
  el.btnLogin.disabled = true;
  el.btnLogin.textContent = "Verificando...";

  try {
    const datos = await apiFetch(`/api/usuarios/login?cedula=${encodeURIComponent(cedula)}`);
    estado.usuario = { nombre: datos.nombre, cedula: datos.cedula, ciudad: datos.ciudad };
    guardarSesion();
    mostrarSesionActiva();
    mostrarPantalla("pantallaModo");
  } catch (error) {
    mostrarMensaje(el.mensajeLogin, error.message, "error");
  } finally {
    el.btnLogin.disabled = false;
    el.btnLogin.textContent = "Ingresar";
  }
});

el.btnLogout.addEventListener("click", cerrarSesion);

// ---------- pantalla 2: elegir modo de cargue ----------

el.btnModoIndividual.addEventListener("click", () => mostrarPantalla("pantallaBuscarPdv"));
el.btnModoMasivo.addEventListener("click", () => mostrarPantalla("pantallaMasivo"));

el.btnVolverModoDesdeBuscar.addEventListener("click", () => {
  reiniciarFlujoIndividual();
  mostrarPantalla("pantallaModo");
});

el.btnVolverModoDesdeMasivo.addEventListener("click", () => {
  reiniciarFlujoMasivo();
  mostrarPantalla("pantallaModo");
});

// ---------- pantalla 3: buscar pdv (cargue individual) ----------

el.inputBuscarPdv.addEventListener("input", () => {
  clearTimeout(temporizadorBusqueda);
  const termino = el.inputBuscarPdv.value.trim();

  if (termino.length < 3) {
    el.resultadosPdv.innerHTML = "";
    ocultarMensaje(el.mensajeBuscarPdv);
    return;
  }

  temporizadorBusqueda = setTimeout(() => buscarPdv(termino), 350);
});

async function buscarPdv(termino) {
  ocultarMensaje(el.mensajeBuscarPdv);
  el.spinnerPdv.hidden = false;
  el.resultadosPdv.innerHTML = "";

  try {
    const datos = await apiFetch(`/api/pdv/buscar?q=${encodeURIComponent(termino)}&limit=25`);
    renderizarResultadosPdv(datos.result || []);
  } catch (error) {
    mostrarMensaje(el.mensajeBuscarPdv, error.message, "error");
  } finally {
    el.spinnerPdv.hidden = true;
  }
}

function renderizarResultadosPdv(resultados) {
  if (resultados.length === 0) {
    el.resultadosPdv.innerHTML = "";
    mostrarMensaje(el.mensajeBuscarPdv, "No se encontraron puntos de venta con ese criterio", "error");
    return;
  }

  el.resultadosPdv.innerHTML = "";
  resultados.forEach((pdv) => {
    const item = document.createElement("li");
    item.innerHTML = `
      <div class="pdv-nombre">${pdv.pdv}</div>
      <div class="pdv-detalle">SAP ${pdv.sap} · ${pdv.ciudad} · ${pdv.canal}</div>
      <div class="pdv-detalle">${pdv.direccion}</div>
    `;
    item.addEventListener("click", () => seleccionarPdv(pdv));
    el.resultadosPdv.appendChild(item);
  });
}

function seleccionarPdv(pdv) {
  estado.pdvSeleccionado = pdv;
  estado.fechasSeleccionadas = [];

  el.resumenPdv.innerHTML = `
    <div><strong>${pdv.pdv}</strong></div>
    <div>SAP: ${pdv.sap}</div>
    <div>Regional: ${pdv.regional || "-"}</div>
    <div>Ciudad: ${pdv.ciudad || "-"}</div>
    <div>Direccion: ${pdv.direccion || "-"}</div>
    <div>Canal: ${pdv.canal || "-"}</div>
  `;

  inicializarCalendario();
  actualizarResumenFechas();
  mostrarPantalla("pantallaFechas");
}

el.btnCambiarPdv.addEventListener("click", () => {
  mostrarPantalla("pantallaBuscarPdv");
});

function reiniciarFlujoIndividual() {
  estado.pdvSeleccionado = null;
  estado.fechasSeleccionadas = [];
  el.inputBuscarPdv.value = "";
  el.resultadosPdv.innerHTML = "";
  ocultarMensaje(el.mensajeBuscarPdv);
  el.btnRegistrar.disabled = true;
  el.btnRegistrar.textContent = "Registrar visitas";
  ocultarMensaje(el.mensajeRegistrar);
}

// ---------- pantalla 4: fechas (cargue individual) ----------

function inicializarCalendario() {
  if (calendarioInstancia) {
    calendarioInstancia.clear();
    return;
  }

  calendarioInstancia = flatpickr(el.calendarioFechas, {
    mode: "multiple",
    dateFormat: "d/m/Y",
    locale: "es",
    minDate: "today",
    onChange: (fechas) => {
      estado.fechasSeleccionadas = fechas.map(formatearFechaISO);
      actualizarResumenFechas();
    },
  });
}

function actualizarResumenFechas() {
  const cantidad = estado.fechasSeleccionadas.length;
  el.resumenFechas.textContent =
    cantidad === 0 ? "Ninguna fecha seleccionada" : `${cantidad} fecha(s) seleccionada(s)`;
  el.btnRegistrar.disabled = cantidad === 0;
}

el.btnRegistrar.addEventListener("click", async () => {
  ocultarMensaje(el.mensajeRegistrar);
  el.btnRegistrar.disabled = true;
  el.btnRegistrar.textContent = "Registrando...";

  try {
    const { filasOk, fallos } = await enviarRegistroPdv(estado.pdvSeleccionado, estado.fechasSeleccionadas);
    mostrarConfirmacion(filasOk, fallos);
  } catch (error) {
    mostrarMensaje(el.mensajeRegistrar, error.message, "error");
    el.btnRegistrar.disabled = false;
    el.btnRegistrar.textContent = "Registrar visitas";
  }
});

// ---------- pantalla 3b: cargue masivo ----------

function normalizarEncabezado(texto) {
  return String(texto ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .trim()
    .replace(/\s+/g, "_");
}

function normalizarSap(valor) {
  const texto = String(valor ?? "").trim().replace(/\.0+$/, "");
  return /^\d+$/.test(texto) ? texto : null;
}

// Excel guarda las fechas como dias desde el 30 de diciembre de 1899
function excelSerialAFecha(serial) {
  return new Date(Math.round((serial - 25569) * 86400 * 1000));
}

// valor puede venir como texto (CSV) o como Date/numero real (celda de Excel)
function parsearFechaCelda(valor) {
  if (valor instanceof Date) {
    return isNaN(valor.getTime()) ? null : formatearFechaISO(valor);
  }

  if (typeof valor === "number") {
    const fecha = excelSerialAFecha(valor);
    return isNaN(fecha.getTime()) ? null : formatearFechaISO(fecha);
  }

  const texto = String(valor ?? "").trim();
  if (!texto) return null;

  let m = texto.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;

  m = texto.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;

  return null;
}

el.btnDescargarPlantilla.addEventListener("click", () => {
  const contenido =
    "SAP,FECHA_VISITA\n10082948,05/09/2026\n10082948,08/09/2026\n10059124,05/09/2026\n";
  const blob = new Blob([contenido], { type: "text/csv;charset=utf-8;" });
  const enlace = document.createElement("a");
  enlace.href = URL.createObjectURL(blob);
  enlace.download = "plantilla_rutero_nutresa.csv";
  document.body.appendChild(enlace);
  enlace.click();
  document.body.removeChild(enlace);
  URL.revokeObjectURL(enlace.href);
});

el.inputArchivoMasivo.addEventListener("change", async () => {
  const archivo = el.inputArchivoMasivo.files[0];
  if (!archivo) return;

  ocultarMensaje(el.mensajeMasivo);
  el.listaErroresMasivo.innerHTML = "";
  el.cardResumenMasivo.hidden = true;
  gruposMasivoValidos = [];
  el.spinnerMasivo.hidden = false;

  try {
    const filas = await leerArchivoMasivo(archivo);
    await procesarFilasMasivo(filas);
  } catch (error) {
    mostrarMensaje(el.mensajeMasivo, error.message, "error");
  } finally {
    el.spinnerMasivo.hidden = true;
  }
});

// El CSV se parsea a mano (texto plano) porque SheetJS intenta adivinar fechas
// en el texto de un CSV usando formato estadounidense y puede correr el dia.
// El .xlsx si trae tipos reales por celda, asi que ahi se le pide el Date nativo.
function leerArchivoMasivo(archivo) {
  const esCsv = /\.csv$/i.test(archivo.name);
  return esCsv ? leerCsvComoTexto(archivo) : leerHojaExcel(archivo);
}

function leerCsvComoTexto(archivo) {
  return new Promise((resolve, reject) => {
    const lector = new FileReader();
    lector.onload = (evento) => {
      try {
        const lineas = String(evento.target.result)
          .split(/\r\n|\n|\r/)
          .filter((linea) => linea.trim() !== "");
        if (lineas.length === 0) return resolve([]);

        const encabezados = lineas[0].split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
        const filas = lineas.slice(1).map((linea) => {
          const celdas = linea.split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
          const fila = {};
          encabezados.forEach((encabezado, i) => (fila[encabezado] = celdas[i] ?? ""));
          return fila;
        });
        resolve(filas);
      } catch (err) {
        reject(new Error("No se pudo leer el archivo CSV."));
      }
    };
    lector.onerror = () => reject(new Error("No se pudo leer el archivo."));
    lector.readAsText(archivo, "UTF-8");
  });
}

function leerHojaExcel(archivo) {
  return new Promise((resolve, reject) => {
    const lector = new FileReader();
    lector.onload = (evento) => {
      try {
        const libro = XLSX.read(evento.target.result, { type: "array", cellDates: true });
        const hoja = libro.Sheets[libro.SheetNames[0]];
        const filas = XLSX.utils.sheet_to_json(hoja, { defval: "", raw: true });
        resolve(filas);
      } catch (err) {
        reject(new Error("No se pudo leer el archivo. Verifica que sea un Excel (.xlsx) valido."));
      }
    };
    lector.onerror = () => reject(new Error("No se pudo leer el archivo."));
    lector.readAsArrayBuffer(archivo);
  });
}

function agregarErrorMasivo(texto) {
  const item = document.createElement("li");
  item.className = "fallo";
  item.textContent = texto;
  el.listaErroresMasivo.appendChild(item);
}

async function procesarFilasMasivo(filas) {
  if (!filas.length) {
    mostrarMensaje(el.mensajeMasivo, "El archivo esta vacio.", "error");
    return;
  }

  if (filas.length > MAX_FILAS_MASIVO) {
    mostrarMensaje(
      el.mensajeMasivo,
      `El archivo tiene demasiadas filas (maximo ${MAX_FILAS_MASIVO}). Dividelo en partes mas pequenas.`,
      "error"
    );
    return;
  }

  const encabezados = Object.keys(filas[0]);
  const columnaSap = encabezados.find((c) => normalizarEncabezado(c) === "SAP");
  const columnaFecha = encabezados.find((c) =>
    ["FECHA_VISITA", "FECHA"].includes(normalizarEncabezado(c))
  );

  if (!columnaSap || !columnaFecha) {
    mostrarMensaje(
      el.mensajeMasivo,
      'El archivo debe tener una columna "SAP" y una columna "FECHA_VISITA" en la primera fila. Descarga la plantilla de ejemplo si tienes dudas.',
      "error"
    );
    return;
  }

  const errores = [];
  const filasValidas = [];
  const clavesVistas = new Set();

  filas.forEach((fila, indice) => {
    const numeroFila = indice + 2; // fila 1 = encabezado
    const valorSap = fila[columnaSap];
    const valorFecha = fila[columnaFecha];
    const sap = normalizarSap(valorSap);
    const fechaISO = parsearFechaCelda(valorFecha);

    if (!sap) {
      errores.push(`Fila ${numeroFila}: el SAP "${valorSap}" no es valido (debe ser numerico)`);
      return;
    }
    if (!fechaISO) {
      errores.push(
        `Fila ${numeroFila}: la fecha "${valorFecha}" no tiene un formato reconocido (usa DD/MM/AAAA o AAAA-MM-DD)`
      );
      return;
    }

    const clave = `${sap}|${fechaISO}`;
    if (clavesVistas.has(clave)) return; // fila repetida, se ignora sin marcar error
    clavesVistas.add(clave);
    filasValidas.push({ sap, fechaISO });
  });

  if (filasValidas.length === 0) {
    errores.forEach(agregarErrorMasivo);
    mostrarMensaje(el.mensajeMasivo, "Ninguna fila del archivo es valida.", "error");
    return;
  }

  const sapsUnicos = [...new Set(filasValidas.map((f) => f.sap))];
  const mapaPdv = {};

  await Promise.all(
    sapsUnicos.map(async (sap) => {
      try {
        const pdv = await buscarPdvPorSap(sap);
        if (pdv) {
          mapaPdv[sap] = pdv;
        } else {
          errores.push(`SAP ${sap}: no se encontro ningun PDV con ese codigo`);
        }
      } catch (err) {
        errores.push(`SAP ${sap}: error consultando el PDV (${err.message})`);
      }
    })
  );

  const grupos = {};
  filasValidas.forEach(({ sap, fechaISO }) => {
    const pdv = mapaPdv[sap];
    if (!pdv) return;
    if (!grupos[sap]) grupos[sap] = { ...pdv, fechas: [] };
    grupos[sap].fechas.push(fechaISO);
  });

  gruposMasivoValidos = Object.values(grupos);

  errores.forEach(agregarErrorMasivo);

  if (gruposMasivoValidos.length === 0) {
    mostrarMensaje(el.mensajeMasivo, "No se encontro ningun PDV valido en el archivo.", "error");
    return;
  }

  renderizarResumenMasivo(gruposMasivoValidos);

  if (errores.length > 0) {
    mostrarMensaje(
      el.mensajeMasivo,
      `${errores.length} fila(s) tienen problemas (detalle abajo). Las demas se pueden registrar.`,
      "error"
    );
  } else {
    mostrarMensaje(el.mensajeMasivo, "Archivo leido correctamente. Revisa el resumen antes de registrar.", "exito");
  }
}

function renderizarResumenMasivo(grupos) {
  el.filasResumenMasivo.innerHTML = "";
  grupos.forEach((grupo) => {
    const fila = document.createElement("tr");
    fila.innerHTML = `
      <td>${grupo.sap}</td>
      <td>${grupo.pdv}</td>
      <td>${grupo.ciudad || "-"}</td>
      <td>${grupo.fechas.map(formatearFechaVisita).join(", ")}</td>
    `;
    el.filasResumenMasivo.appendChild(fila);
  });
  el.cardResumenMasivo.hidden = false;
}

el.btnRegistrarMasivo.addEventListener("click", async () => {
  el.btnRegistrarMasivo.disabled = true;
  el.btnRegistrarMasivo.textContent = "Registrando...";

  const filasOk = [];
  const fallos = [];

  for (const grupo of gruposMasivoValidos) {
    try {
      const resultado = await enviarRegistroPdv(grupo, grupo.fechas);
      filasOk.push(...resultado.filasOk);
      fallos.push(...resultado.fallos);
    } catch (error) {
      grupo.fechas.forEach((fecha) => fallos.push({ ...grupo, fecha, error: error.message }));
    }
  }

  el.btnRegistrarMasivo.disabled = false;
  el.btnRegistrarMasivo.textContent = "Registrar rutero masivo";
  mostrarConfirmacion(filasOk, fallos);
});

function reiniciarFlujoMasivo() {
  gruposMasivoValidos = [];
  el.inputArchivoMasivo.value = "";
  el.listaErroresMasivo.innerHTML = "";
  el.cardResumenMasivo.hidden = true;
  ocultarMensaje(el.mensajeMasivo);
}

// ---------- pantalla 5: confirmacion (comun a ambos modos) ----------

function mostrarConfirmacion(filasOk, fallos) {
  el.listaErrores.innerHTML = "";
  fallos.forEach((f) => {
    const item = document.createElement("li");
    item.className = "fallo";
    item.textContent = `Fallo ${f.pdv} - ${formatearFechaVisita(f.fecha)}: ${f.error}`;
    el.listaErrores.appendChild(item);
  });

  el.filasReporte.innerHTML = "";
  filasOk.forEach((f) => {
    const fila = document.createElement("tr");
    fila.innerHTML = `
      <td>${f.sap}</td>
      <td>${f.pdv}</td>
      <td>${f.regional || "-"}</td>
      <td>${f.ciudad || "-"}</td>
      <td>${f.direccion || "-"}</td>
      <td>${f.canal || "-"}</td>
      <td>${formatearFechaVisita(f.fecha)}</td>
      <td>PDT VISITA</td>
      <td>${estado.usuario.nombre}</td>
      <td>${estado.usuario.cedula}</td>
      <td>PROGRAMACION</td>
    `;
    el.filasReporte.appendChild(fila);
  });
  el.cardReporte.hidden = filasOk.length === 0;

  if (fallos.length === 0) {
    mostrarMensaje(el.mensajeConfirmacion, `Se registraron ${filasOk.length} visita(s) correctamente.`, "exito");
  } else if (filasOk.length > 0) {
    mostrarMensaje(
      el.mensajeConfirmacion,
      `Se registraron ${filasOk.length} visita(s), pero ${fallos.length} fallaron.`,
      "error"
    );
  } else {
    mostrarMensaje(el.mensajeConfirmacion, "No se pudo registrar ninguna visita.", "error");
  }

  mostrarPantalla("pantallaConfirmacion");
}

el.btnVolverInicio.addEventListener("click", () => {
  reiniciarFlujoIndividual();
  reiniciarFlujoMasivo();
  mostrarPantalla("pantallaModo");
});

cargarSesion();
