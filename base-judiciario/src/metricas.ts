import { Counter, Gauge, Registry, collectDefaultMetrics } from 'prom-client';

export const registro = new Registry();
collectDefaultMetrics({ register: registro });

export const contadorRequisicoesFonte = new Counter({
  name: 'fonte_requisicoes_total',
  help: 'Chamadas HTTP às fontes externas, por fonte e status',
  labelNames: ['fonte', 'status'],
  registers: [registro],
});

export const contadorExecucoes = new Counter({
  name: 'coleta_execucoes_total',
  help: 'Execuções de coleta por fonte e situação',
  labelNames: ['fonte', 'situacao'],
  registers: [registro],
});

export const contadorItens = new Counter({
  name: 'coleta_itens_total',
  help: 'Itens coletados por fonte (novos e repetidos)',
  labelNames: ['fonte', 'novo'],
  registers: [registro],
});

export const contadorEntregas = new Counter({
  name: 'eventos_entregas_total',
  help: 'Tentativas de entrega de eventos por resultado',
  labelNames: ['resultado'],
  registers: [registro],
});

export const medidorEventosPendentes = new Gauge({
  name: 'eventos_pendentes',
  help: 'Eventos aguardando entrega',
  registers: [registro],
});
