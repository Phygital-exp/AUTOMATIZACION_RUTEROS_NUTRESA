const STORAGE_KEY = "nutresa_las_usuario";

const estado = {
  usuario: null, // { nombre, cedula, ciudad }
  pdvSeleccionado: null, // { sap, pdv, regional, ciudad, direccion, canal }
  fechasSeleccionadas: [], // ["2026-09-05", ...]
};

const el = {
  usuarioInfo: document.getElementById("usuarioInfo"),
  usuarioNombre: document.getElementById("usuarioNombre"),
  btnLogout: document.getElementById("btnLogout"),

  pantallaLogin: document.getElementById("pantallaLogin"),
  formLogin: document.getElementById("formLogin"),
  inputCedula: document.getElementById("inputCedula"),
  btnLogin: document.getElementById("btnLogin"),
  mensajeLogin: document.getElementById("mensajeLogin"),

  pantallaBuscarPdv: document.getElementById("pantallaBuscarPdv"),
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

  pantallaConfirmacion: document.getElementById("pantallaConfirmacion"),
  mensajeConfirmacion: document.getElementById("mensajeConfirmacion"),
  listaRegistros: document.getElementById("listaRegistros"),
  btnNuevoPdv: document.getElementById("btnNuevoPdv"),
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

// ---------- sesion ----------

function cargarSesion() {
  const guardado = sessionStorage.getItem(STORAGE_KEY);
  if (!guardado) return;
  try {
    estado.usuario = JSON.parse(guardado);
    mostrarSesionActiva();
    mostrarPantalla("pantallaBuscarPdv");
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
  estado.pdvSeleccionado = null;
  estado.fechasSeleccionadas = [];
  el.usuarioInfo.hidden = true;
  el.inputCedula.value = "";
  el.inputBuscarPdv.value = "";
  el.resultadosPdv.innerHTML = "";
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
    mostrarPantalla("pantallaBuscarPdv");
  } catch (error) {
    mostrarMensaje(el.mensajeLogin, error.message, "error");
  } finally {
    el.btnLogin.disabled = false;
    el.btnLogin.textContent = "Ingresar";
  }
});

el.btnLogout.addEventListener("click", cerrarSesion);

// ---------- pantalla 2: buscar pdv ----------

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

// ---------- pantalla 3: fechas ----------

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

  const pdv = estado.pdvSeleccionado;

  try {
    const datos = await apiFetch("/api/rutero/registrar", {
      method: "POST",
      body: JSON.stringify({
        sap: pdv.sap,
        pdv: pdv.pdv,
        regional: pdv.regional,
        ciudad: pdv.ciudad,
        direccion: pdv.direccion,
        canal: pdv.canal,
        fechas: estado.fechasSeleccionadas,
        lasCedula: estado.usuario.cedula,
      }),
    });
    mostrarConfirmacion(datos);
  } catch (error) {
    mostrarMensaje(el.mensajeRegistrar, error.message, "error");
    el.btnRegistrar.disabled = false;
    el.btnRegistrar.textContent = "Registrar visitas";
  }
});

// ---------- pantalla 4: confirmacion ----------

function mostrarConfirmacion(datos) {
  const creados = datos.creados || [];
  const errores = datos.errores || [];

  el.listaRegistros.innerHTML = "";
  creados.forEach((registro) => {
    const item = document.createElement("li");
    item.className = "ok";
    item.textContent = `Registrado: ${registro.fecha}`;
    el.listaRegistros.appendChild(item);
  });
  errores.forEach((registro) => {
    const item = document.createElement("li");
    item.className = "fallo";
    item.textContent = `Fallo ${registro.fecha}: ${registro.error}`;
    el.listaRegistros.appendChild(item);
  });

  if (errores.length === 0) {
    mostrarMensaje(
      el.mensajeConfirmacion,
      `Se registraron ${creados.length} visita(s) correctamente.`,
      "exito"
    );
  } else if (creados.length > 0) {
    mostrarMensaje(
      el.mensajeConfirmacion,
      `Se registraron ${creados.length} visita(s), pero ${errores.length} fallaron.`,
      "error"
    );
  } else {
    mostrarMensaje(el.mensajeConfirmacion, "No se pudo registrar ninguna visita.", "error");
  }

  mostrarPantalla("pantallaConfirmacion");
}

el.btnNuevoPdv.addEventListener("click", () => {
  estado.pdvSeleccionado = null;
  estado.fechasSeleccionadas = [];
  el.inputBuscarPdv.value = "";
  el.resultadosPdv.innerHTML = "";
  el.btnRegistrar.disabled = true;
  el.btnRegistrar.textContent = "Registrar visitas";
  ocultarMensaje(el.mensajeRegistrar);
  mostrarPantalla("pantallaBuscarPdv");
});

cargarSesion();
