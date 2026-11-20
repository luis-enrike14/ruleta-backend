require('dotenv').config(); // 👈 Carga las variables de tu archivo .env
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg'); // 👈 Usamos PostgreSQL en lugar de SQLite

const app = express();
app.use(cors());
app.use(express.json());

// Configuramos la conexión a Supabase
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false // Requerido por Supabase para conexiones externas
  }
});

// Función para inicializar y verificar las tablas en Supabase
async function initDB() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS folios (
        id SERIAL PRIMARY KEY,
        codigo TEXT UNIQUE NOT NULL,
        usado INTEGER DEFAULT 0,
        giros_restantes INTEGER DEFAULT 1,
        tipo_giro_extra INTEGER DEFAULT 0,
        premio_asignado TEXT DEFAULT 'Sin asignar',
        premio_ganado TEXT,
        fecha_uso TEXT
      );

      CREATE TABLE IF NOT EXISTS configuracion_rifa (
        id INTEGER PRIMARY KEY,
        datos TEXT
      );
    `);
    console.log('✅ Conectado exitosamente a Supabase (PostgreSQL)');
  } catch (err) {
    console.error('❌ Error al conectar con Supabase:', err.message);
  }
}

const SECCIONES = [
  { id: 1, premio: "$300 pesos", esPremio: true, color: "#FF4D4D" },
  { id: 2, premio: "$250 pesos", esPremio: true, color: "#4DA6FF" },
  { id: 3, premio: "$150 pesos", esPremio: true, color: "#FFD700" },
  { id: 4, premio: "$50 pesos",  esPremio: true, color: "#4DFF88" },
  { id: 5, premio: "Bono de $20 pesos",  esPremio: true, color: "#9b59b6" },
  { id: 6, premio: "1 Giro Extra", esPremio: false, esGiroExtra: true, color: "#ff8c00" },
  { id: 7, premio: "2 Giros Extras", esPremio: false, esGiroExtra: true, color: "#e67e22" },
  { id: 8, premio: "Suerte para la próxima", esPremio: false, color: "#CCCCCC" }
];

const PREMIOS_CONFIG = [
  { premio: "$300 pesos", cantidad: 1 },
  { premio: "$250 pesos", cantidad: 1 },
  { premio: "$150 pesos", cantidad: 1 },
  { premio: "$50 pesos",  cantidad: 4 },
  { premio: "Bono de $20 pesos",  cantidad: 30 },
  { premio: "Suerte para la próxima", cantidad: 63 }
];

// Función principal para iniciar la base de datos y levantar el servidor ordenadamente
async function main() {
  try {
    await initDB();

    const PORT = process.env.PORT || 3001;
    app.listen(PORT, () => {
      console.log(`Servidor Backend corriendo en el puerto ${PORT}`);
    });
  } catch (error) {
    console.error('Error al iniciar la aplicación:', error);
    process.exit(1);
  }
}

main();

function generarCodigo5() {
  const caracteres = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let resultado = '';
  for (let i = 0; i < 5; i++) {
    resultado += caracteres.charAt(Math.floor(Math.random() * caracteres.length));
  }
  return resultado;
}

app.get('/api/ruleta-config', (req, res) => {
  res.json({ secciones: SECCIONES });
});

// ==========================================
// 🆕 NUEVOS ENDPOINTS PARA LA TABLA DE LA RIFA
// ==========================================

// Endpoint para obtener la lista sincronizada desde Supabase
app.get('/api/rifa/numeros', async (req, res) => {
  try {
    const result = await pool.query("SELECT datos FROM configuracion_rifa WHERE id = 1");
    if (result.rows.length > 0 && result.rows[0].datos) {
      res.json(JSON.parse(result.rows[0].datos));
    } else {
      res.json({});
    }
  } catch (err) {
    console.error("Error al obtener los números de la rifa:", err);
    res.status(500).json({ error: "Error en el servidor" });
  }
});

// Endpoint para guardar la lista completa en Supabase de forma persistente
app.post('/api/rifa/guardar', async (req, res) => {
  try {
    const nuevosNumeros = req.body;
    const datosJsonString = JSON.stringify(nuevosNumeros);

    await pool.query(
      `INSERT INTO configuracion_rifa (id, datos) VALUES (1, $1) 
       ON CONFLICT (id) DO UPDATE SET datos = EXCLUDED.datos`,
      [datosJsonString]
    );

    res.json({ success: true, message: "Rifa guardada correctamente en la BD" });
  } catch (err) {
    console.error("Error al guardar la rifa en Supabase:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==========================================

app.post('/api/girar', async (req, res) => {
  const { codigo } = req.body;
  const codigoLimpio = codigo ? codigo.trim().toUpperCase() : "";

  if (!codigoLimpio) {
    return res.status(400).json({ error: "Ingresa un folio de participación válido." });
  }

  try {
    const result = await pool.query('SELECT * FROM folios WHERE codigo = $1', [codigoLimpio]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "El folio ingresado NO es válido o no está registrado." });
    }

    const folioReg = result.rows[0];

    if (folioReg.premio_asignado === 'Sin asignar' || !folioReg.premio_asignado) {
      return res.status(400).json({ error: "Este folio aún no tiene un premio asignado por el administrador." });
    }

    if (folioReg.usado === 1 && folioReg.giros_restantes <= 0) {
      return res.status(400).json({ 
        error: `Este folio ya agotó todos sus giros el ${folioReg.fecha_uso}.` 
      });
    }

    let indiceGanador;
    let nuevosGirosRestantes = folioReg.giros_restantes;

    // CASO 1: Si tiene 2 giros extras pendientes (es su primer tiro)
    if (folioReg.tipo_giro_extra === 2 && folioReg.giros_restantes === 3) {
      indiceGanador = SECCIONES.findIndex(s => s.premio === "2 Giros Extras");
      nuevosGirosRestantes = 2; // Quedan 2 giros por delante

      await pool.query('UPDATE folios SET giros_restantes = $1 WHERE id = $2', [nuevosGirosRestantes, folioReg.id]);

      return res.json({
        exito: true,
        indiceGanador: indiceGanador >= 0 ? indiceGanador : 6,
        resultado: SECCIONES[indiceGanador >= 0 ? indiceGanador : 6],
        girosRestantes: nuevosGirosRestantes,
        esUltimoGiro: false,
        mensaje: "¡Felicidades! Caíste en 2 Giros Extras. ¡Presiona el botón para girar de nuevo!"
      });
    }

    // CASO 2: Si está gastando el primer giro extra de esos 2 (debe caer en "Suerte para la próxima")
    else if (folioReg.tipo_giro_extra === 2 && folioReg.giros_restantes === 2) {
      indiceGanador = SECCIONES.findIndex(s => s.premio === "Suerte para la próxima");
      nuevosGirosRestantes = 1; // Queda 1 tiro final

      await pool.query('UPDATE folios SET giros_restantes = $1 WHERE id = $2', [nuevosGirosRestantes, folioReg.id]);

      return res.json({
        exito: true,
        indiceGanador: indiceGanador >= 0 ? indiceGanador : 7,
        resultado: SECCIONES[indiceGanador >= 0 ? indiceGanador : 7],
        girosRestantes: nuevosGirosRestantes,
        esUltimoGiro: false,
        mensaje: "¡Cerca!. ¡Te queda tu último giro extra, presiona el botón!"
      });
    }

    // CASO 3: Si tiene 1 giro extra pendiente (es su primer tiro y cae en "1 Giro Extra")
    else if (folioReg.tipo_giro_extra === 1 && folioReg.giros_restantes === 2) {
      indiceGanador = SECCIONES.findIndex(s => s.premio === "1 Giro Extra");
      nuevosGirosRestantes = 1; // Queda 1 tiro final

      await pool.query('UPDATE folios SET giros_restantes = $1 WHERE id = $2', [nuevosGirosRestantes, folioReg.id]);

      return res.json({
        exito: true,
        indiceGanador: indiceGanador >= 0 ? indiceGanador : 5,
        resultado: SECCIONES[indiceGanador >= 0 ? indiceGanador : 5],
        girosRestantes: nuevosGirosRestantes,
        esUltimoGiro: false,
        mensaje: "¡Felicidades! Ganaste 1 Giro Extra. ¡Presiona el botón para girar de nuevo!"
      });
    }

    // CASO 4: Es su tiro definitivo (Premio real asignado o Suerte final)
    else {
      const premioAsignadoTexto = folioReg.premio_asignado;
      indiceGanador = SECCIONES.findIndex(s => s.premio === premioAsignadoTexto);
      if (indiceGanador === -1) indiceGanador = 7;

      const resultado = SECCIONES[indiceGanador];

      // Generación exacta de la hora local de Sonora usando zona horaria con formato numérico seguro
      const fechaLocalObj = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Hermosillo" }));
      const dia = String(fechaLocalObj.getDate()).padStart(2, '0');
      const mes = String(fechaLocalObj.getMonth() + 1).padStart(2, '0');
      const anio = fechaLocalObj.getFullYear();
      
      let hora24 = fechaLocalObj.getHours();
      const minutos = String(fechaLocalObj.getMinutes()).padStart(2, '0');
      const segundos = String(fechaLocalObj.getSeconds()).padStart(2, '0');
      
      const ampm = hora24 >= 12 ? 'p. m.' : 'a. m.';
      let hora12 = hora24 % 12;
      hora12 = hora12 ? hora12 : 12; // Si es 0 se convierte en 12
      const horaStr = String(hora12).padStart(2, '0');

      const fechaHoraLocal = `${dia}/${mes}/${anio}, ${horaStr}:${minutos}:${segundos} ${ampm}`;

      await pool.query(
        'UPDATE folios SET usado = 1, giros_restantes = 0, premio_ganado = $1, fecha_uso = $2 WHERE id = $3',
        [resultado.premio, fechaHoraLocal, folioReg.id]
      );

      return res.json({
        exito: true,
        indiceGanador,
        resultado,
        girosRestantes: 0,
        esUltimoGiro: true,
        fechaUso: fechaHoraLocal,
        mensaje: resultado.esPremio 
          ? `¡Felicidades! Ganaste: ${resultado.premio}` 
          : "Gracias por participar. ¡Suerte para la próxima!"
      });
    }

  } catch (error) {
    console.error("Error al procesar el giro:", error);
    res.status(500).json({ error: "Error en el servidor." });
  }
});

app.get('/api/admin/folios', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM folios ORDER BY id DESC');
    res.json({ folios: result.rows });
  } catch (err) {
    res.status(500).json({ error: "Error al consultar folios." });
  }
});

app.post('/api/admin/folios', async (req, res) => {
  const { codigos } = req.body;
  if (!codigos || !Array.isArray(codigos) || codigos.length === 0) {
    return res.status(400).json({ error: "Proporciona una lista de folios válida." });
  }

  let agregados = 0;
  for (let c of codigos) {
    const limpio = c.trim().toUpperCase();
    if (limpio) {
      try {
        await pool.query('INSERT INTO folios (codigo, premio_asignado) VALUES ($1, $2)', [limpio, "Suerte para la próxima"]);
        agregados++;
      } catch (err) {}
    }
  }
  res.json({ exito: true, agregados });
});

app.post('/api/admin/generar-aleatorios', async (req, res) => {
  try {
    await pool.query('DELETE FROM folios');

    let codigosUnicos = new Set();
    while (codigosUnicos.size < 100) {
      codigosUnicos.add(generarCodigo5());
    }

    for (let codigo of codigosUnicos) {
      await pool.query('INSERT INTO folios (codigo, premio_asignado, giros_restantes, tipo_giro_extra) VALUES ($1, $2, 1, 0)', [codigo, 'Sin asignar']);
    }

    res.json({ exito: true, creados: 100 });
  } catch (err) {
    console.error("Error al generar aleatorios:", err);
    res.status(500).json({ error: "Error al generar folios aleatorios." });
  }
});

app.post('/api/admin/asignar-premios', async (req, res) => {
  try {
    const result = await pool.query('SELECT id FROM folios');
    const folios = result.rows;
    if (folios.length === 0) {
      return res.status(400).json({ error: "Primero debes generar los 100 códigos." });
    }

    let bolsaPremios = [];
    PREMIOS_CONFIG.forEach(p => {
      for (let i = 0; i < p.cantidad; i++) {
        bolsaPremios.push(p.premio);
      }
    });

    for (let i = bolsaPremios.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [bolsaPremios[i], bolsaPremios[j]] = [bolsaPremios[j], bolsaPremios[i]];
    }

    for (let i = 0; i < folios.length; i++) {
      const premioAsignado = bolsaPremios[i] || "Suerte para la próxima";
      await pool.query('UPDATE folios SET premio_asignado = $1 WHERE id = $2', [premioAsignado, folios[i].id]);
    }

    res.json({ exito: true, mensaje: "Premios asignados correctamente." });
  } catch (err) {
    console.error("Error al asignar premios:", err);
    res.status(500).json({ error: "Error al asignar premios." });
  }
});

app.post('/api/admin/asignar-giros-extra', async (req, res) => {
  try {
    const resultFolios = await pool.query('SELECT id FROM folios');
    const folios = resultFolios.rows;
    if (folios.length === 0) {
      return res.status(400).json({ error: "No hay folios registrados." });
    }

    await pool.query('UPDATE folios SET giros_restantes = 1, tipo_giro_extra = 0');

    let totalExtrasRepartir = 50;
    while (totalExtrasRepartir > 0) {
      const f = folios[Math.floor(Math.random() * folios.length)];
      const regResult = await pool.query('SELECT tipo_giro_extra FROM folios WHERE id = $1', [f.id]);
      
      if (regResult.rows.length > 0 && regResult.rows[0].tipo_giro_extra === 0) {
        const cuantoDar = Math.random() < 0.5 ? 1 : 2;
        const girosTotalesIniciales = cuantoDar === 2 ? 3 : 2;

        await pool.query(
          'UPDATE folios SET tipo_giro_extra = $1, giros_restantes = $2 WHERE id = $3',
          [cuantoDar, girosTotalesIniciales, f.id]
        );
        totalExtrasRepartir -= cuantoDar;
      }
    }

    res.json({ exito: true, mensaje: "¡Giros extras distribuidos con la secuencia exacta (Extra -> Suerte -> Premio)!" });
  } catch (err) {
    console.error("Error al asignar giros extra:", err);
    res.status(500).json({ error: "Error al asignar giros extra." });
  }
});

app.delete('/api/admin/folios/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query('DELETE FROM folios WHERE id = $1', [id]);
    res.json({ exito: true, mensaje: "Folio eliminado correctamente." });
  } catch (err) {
    res.status(500).json({ error: "Error al eliminar el folio." });
  }
});

app.delete('/api/admin/folios-todos', async (req, res) => {
  try {
    await pool.query('DELETE FROM folios');
    // En PostgreSQL no requerimos sqlite_sequence, pero podemos reiniciar el autoincrement opcionalmente si se desea con ALTER SEQUENCE o TRUNCATE
    await pool.query('DELETE FROM configuracion_rifa');

    res.json({ exito: true, mensaje: "Se han eliminado todos los folios y la configuración de la rifa por completo." });
  } catch (err) {
    console.error("Error al vaciar tablas:", err);
    res.status(500).json({ error: "Error al eliminar todos los folios." });
  }
});