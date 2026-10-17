// Dados fictícios usados só pelos testes (não entram no app publicado).
// Cobrem os formatos que o conversor precisa reconhecer.

const I = (date, description, amount, category = 'Salário') => ({
  date, description, amount, category, type: 'income', status: 'pending', method: '', notes: '',
})
const E = (date, description, amount, category, method = 'Pix') => ({
  date, description, amount, category, type: 'expense', status: 'pending', method, notes: '',
})

export const SAMPLE = [
  I('2026-11-01', 'Salário', 3000),
  E('2026-11-01', 'Parcela do carro', 400, 'Transporte'),
  E('2026-11-01', 'Empréstimo – parcela 1/2', 300, 'Empréstimo', 'Débito'),
  E('2026-11-15', 'Streaming', 110, 'Assinaturas', 'Cartão'),
  E('2026-11-15', 'Gasolina', 175, 'Transporte'),
  E('2026-11-15', 'Lanches (vale)', 150, 'Alimentação', 'Vale iFood'),
  E('2026-11-20', 'Parcela do celular', 335, 'Celular', 'Boleto'),
  E('2026-11-22', 'Óculos – 2/3', 33.33, 'Cartão', 'Cartão'),

  I('2026-12-01', 'Salário', 3000),
  E('2026-12-01', 'Parcela do carro', 400, 'Transporte'),
  E('2026-12-01', 'Empréstimo – parcela 2/2 (última)', 300, 'Empréstimo', 'Débito'),
  E('2026-12-11', 'Fone – 1/6', 92, 'Pessoal', 'Cartão'),
  E('2026-12-12', 'Revisão do carro – 1/2', 100, 'Transporte', 'Cartão'),
  E('2026-12-15', 'Streaming', 110, 'Assinaturas', 'Cartão'),
  E('2026-12-15', 'Gasolina', 175, 'Transporte'),
  E('2026-12-18', 'Parcela da viagem (fim de ano)', 100, 'Lazer'),
  E('2026-12-20', 'Parcela do celular', 335, 'Celular', 'Boleto'),
  E('2026-12-22', 'Óculos – 3/3 (última)', 33.33, 'Cartão', 'Cartão'),

  I('2027-01-01', 'Salário', 3000),
  E('2027-01-01', 'Parcela do carro', 400, 'Transporte'),
  E('2027-01-05', 'Curso – 1ª mensalidade', 575, 'Faculdade', 'Boleto'),
  E('2027-01-11', 'Fone – 2/6', 92, 'Pessoal', 'Cartão'),
  E('2027-01-12', 'Revisão do carro – 2/2', 100, 'Transporte', 'Cartão'),
  E('2027-01-15', 'Streaming', 110, 'Assinaturas', 'Cartão'),
  E('2027-01-15', 'Gasolina', 175, 'Transporte'),
  E('2027-01-18', 'Parcela da viagem', 100, 'Lazer'),
  E('2027-01-20', 'Parcela do celular', 335, 'Celular', 'Boleto'),
  E('2027-01-25', 'Anel – 1/3', 99.93, 'Presentes', 'Cartão'),
]
