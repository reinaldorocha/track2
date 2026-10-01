const secret = process.env.CRON_SECRET
if (!secret) {
  console.error('CRON_SECRET é obrigatório para a sincronização automática da Meta')
  process.exit(1)
}

const run = async () => {
  try {
    const response = await fetch('http://utm-track:3000/api/meta/auto-sync', {
      headers: { authorization: `Bearer ${secret}` },
      signal: AbortSignal.timeout(10 * 60 * 1000),
    })
    if (!response.ok) console.error(`Meta auto-sync retornou HTTP ${response.status}`)
  } catch (error) {
    console.error('Falha ao executar Meta auto-sync:', error.message)
  }
}

setTimeout(() => {
  void run()
  setInterval(() => void run(), 15 * 60 * 1000)
}, 30 * 1000)
