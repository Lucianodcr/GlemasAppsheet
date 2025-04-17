// api/procesar-stock.js

const APPSHEET_APP_ID     = process.env.APPSHEET_APP_ID;
const APPSHEET_ACCESS_KEY = process.env.APPSHEET_ACCESS_KEY;
const BASE_URL            = `https://api.appsheet.com/api/v2/apps/${APPSHEET_APP_ID}`;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no soportado' });
  }

  const { DetalleFCID } = await req.json();
  console.log('Received:', DetalleFCID);

  // 1) Leer detalles pendientes
  const pendientesResp = await fetch(`${BASE_URL}/tables/DetalleFacturasCompra/Action`, {
    method: 'POST',
    headers: {
      'ApplicationAccessKey': APPSHEET_ACCESS_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      Action: 'Find',
      Properties: {
        Locale: 'es-AR',
        Selector: 'Filter(DetalleFacturasCompra, [StockActualizado]="N")'
      },
      Rows: []
    })
  });
  const detalles = await pendientesResp.json();

  // 2) Agrupar y sumar
  const map = {};
  detalles.forEach(r => {
    const key  = `${r.FacturaCompraID}|${r.ProductoID}`;
    const cant = Number(r.CantidadRecibida) || 0;
    const cos  = Number(r.CostoUnitarioReal) || 0;
    if (!map[key]) map[key] = { ProductoID: r.ProductoID, totalCant: 0, ultCosto: 0 };
    map[key].totalCant += cant;
    map[key].ultCosto   = cos;
  });
  const sumas = Object.values(map);

  // 3) Leer stock actual de Productos
  const idsList = sumas.map(s => `"${s.ProductoID}"`).join(',');
  const prodResp = await fetch(`${BASE_URL}/tables/Productos/Action`, {
    method: 'POST',
    headers: {
      'ApplicationAccessKey': APPSHEET_ACCESS_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      Action: 'Find',
      Properties: {
        Locale: 'es-AR',
        Selector: `Filter(Productos, IN([ProductoID], LIST(${idsList})))`
      },
      Rows: []
    })
  });
  const productos = await prodResp.json();

  // 4) Actualizar Productos
  const rowsProd = sumas.map(s => {
    const p = productos.find(x => x.ProductoID === s.ProductoID) || {};
    const actual = Number(p.StockActual) || 0;
    return {
      ProductoID: s.ProductoID,
      StockActual: actual + s.totalCant,
      CostoActual: s.ultCosto,
      EstadoActualizacion: 'Esperando'
    };
  });
  await fetch(`${BASE_URL}/tables/Productos/Action`, {
    method: 'POST',
    headers: {
      'ApplicationAccessKey': APPSHEET_ACCESS_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      Action: 'Edit',
      Properties: { Locale: 'es-AR' },
      Rows: rowsProd
    })
  });

  // 5) Marcar detalles procesados
  const rowsDet = detalles.map(r => ({
    DetalleFCID:      r.DetalleFCID,
    StockActualizado: true
  }));
  await fetch(`${BASE_URL}/tables/DetalleFacturasCompra/Action`, {
    method: 'POST',
    headers: {
      'ApplicationAccessKey': APPSHEET_ACCESS_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      Action: 'Edit',
      Properties: { Locale: 'es-AR' },
      Rows: rowsDet
    })
  });

  return res.status(200).json({ status: 'ok', processed: detalles.length });
}
