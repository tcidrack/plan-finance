// Plano inicial: out/2026 a jan/2027.
// Regra do ciclo: o salário do dia 30 paga o mês SEGUINTE, então salário e moto
// ficam datados no dia 01 do mês que eles pagam.

export const OPENING = { opening_balance: 166.65, opening_date: '2026-10-16' }

const I = (date, description, amount, category = 'Salário', status = 'pending', notes = '') => ({
  date, description, amount, category, type: 'income', status, method: '', notes,
})
const E = (date, description, amount, category, method = 'Pix', status = 'pending', notes = '') => ({
  date, description, amount, category, type: 'expense', status, method, notes,
})

export const SEED = [
  // ───────── OUTUBRO ─────────
  E('2026-10-09', 'Fatura Mercado Livre', 117.68, 'Cartão', 'Boleto', 'paid'),
  E('2026-10-14', 'Crédito celular', 35, 'Celular', 'Cartão Nubank', 'paid'),
  I('2026-10-20', 'Empréstimo Nubank (2x)', 700, 'Empréstimo', 'pending', 'Pegar dia 20/10'),
  E('2026-10-20', 'Parcela do celular', 335, 'Celular', 'Boleto'),
  E('2026-10-22', 'Cartão da Ester (açaí + óculos + gasolina)', 109.66, 'Cartão', 'Cartão Ester'),
  E('2026-10-24', 'Gasolina (restante)', 78.52, 'Transporte', 'Pix', 'pending', 'Total do mês R$ 175; R$ 96,48 já pagos'),
  E('2026-10-25', 'Fatura PicPay', 312.66, 'Cartão', 'Boleto'),

  // ───────── NOVEMBRO ─────────
  I('2026-11-01', 'Salário (paga novembro)', 3253.18),
  E('2026-11-01', 'Parcela da moto', 400, 'Moto', 'Pix'),
  E('2026-11-01', 'Empréstimo Nubank – parcela 1/2', 367.93, 'Empréstimo', 'Débito'),
  E('2026-11-02', 'Fatura Itaú', 544.08, 'Cartão', 'Boleto'),
  E('2026-11-03', 'Seguro da moto', 90, 'Moto', 'Pix'),
  E('2026-11-04', 'Presente Thayla (bicicleta)', 120, 'Presentes', 'Pix', 'pending', 'Aniversário de 1 ano da irmã'),
  E('2026-11-07', 'Corte de cabelo', 38, 'Pessoal', 'Pix'),
  E('2026-11-10', 'Ajuda em casa', 100, 'Família', 'Pix'),
  E('2026-11-11', 'Fatura Nubank', 656.47, 'Cartão', 'Boleto'),
  E('2026-11-13', 'Fatura Mercado Livre', 63.73, 'Cartão', 'Boleto'),
  E('2026-11-15', 'Crédito celular', 35, 'Celular', 'Cartão Nubank'),
  E('2026-11-15', 'Claude Pro', 110, 'Assinaturas', 'Cartão Nubank'),
  E('2026-11-15', 'Gasolina', 175, 'Transporte', 'Pix'),
  E('2026-11-15', 'Merendas / lanches (vale iFood)', 150, 'Alimentação', 'Vale iFood', 'pending', 'Sobra do vale R$ 550 − R$ 400 em casa; não sai da conta'),
  E('2026-11-20', 'Parcela do celular', 335, 'Celular', 'Boleto'),
  E('2026-11-20', 'Chá de fraldas – minha metade de R$ 93 (cartão da namorada)', 46.5, 'Presentes', 'Cartão namorada'),
  E('2026-11-20', 'Jantar de 16/10 (cartão da namorada)', 71, 'Alimentação', 'Cartão namorada', 'pending', 'Fatura da namorada vence 20/11'),
  E('2026-11-22', 'Óculos da Ester – 2/3', 33.33, 'Cartão', 'Cartão Ester'),
  E('2026-11-25', 'Fatura PicPay', 111.15, 'Cartão', 'Boleto'),

  // ───────── DEZEMBRO ─────────
  I('2026-12-01', 'Salário (paga dezembro)', 3253.18),
  E('2026-12-01', 'Parcela da moto', 400, 'Moto', 'Pix'),
  E('2026-12-01', 'Empréstimo Nubank – parcela 2/2 (última)', 367.93, 'Empréstimo', 'Débito'),
  E('2026-12-02', 'Fatura Itaú', 65.32, 'Cartão', 'Boleto'),
  E('2026-12-02', 'Perfume (Itaú)', 155, 'Presentes', 'Cartão Itaú', 'pending', 'Comprar após 27/10 para cair na fatura de 02/12'),
  E('2026-12-02', 'Formatura (Itaú)', 100, 'Presentes', 'Cartão Itaú'),
  E('2026-12-03', 'Seguro da moto', 90, 'Moto', 'Pix'),
  E('2026-12-07', 'Corte de cabelo', 38, 'Pessoal', 'Pix'),
  E('2026-12-10', 'Fatura Mercado Livre', 27.38, 'Cartão', 'Boleto'),
  E('2026-12-11', 'Fatura Nubank', 269.52, 'Cartão', 'Boleto'),
  E('2026-12-11', 'Capacetes – 1/6', 92, 'Moto', 'Cartão Nubank'),
  E('2026-12-12', 'Revisão da moto – 1/2', 100, 'Moto', 'Cartão', 'pending', 'Total estimado R$ 200, parcelado em 2x'),
  E('2026-12-15', 'Crédito celular', 35, 'Celular', 'Cartão Nubank'),
  E('2026-12-15', 'Claude Pro', 110, 'Assinaturas', 'Cartão Nubank'),
  E('2026-12-15', 'Gasolina', 175, 'Transporte', 'Pix'),
  E('2026-12-15', 'Merendas / lanches (vale iFood)', 150, 'Alimentação', 'Vale iFood'),
  E('2026-12-18', 'Parcela da viagem (fim de ano)', 100, 'Lazer', 'Pix'),
  E('2026-12-20', 'Parcela do celular', 335, 'Celular', 'Boleto'),
  E('2026-12-20', 'Roupa de fim de ano', 125, 'Pessoal', 'Pix', 'pending', 'Estimativa R$ 100–150'),
  E('2026-12-22', 'Óculos da Ester – 3/3 (última)', 33.33, 'Cartão', 'Cartão Ester'),
  E('2026-12-23', 'Buquê', 150, 'Presentes', 'Pix'),
  E('2026-12-28', 'Reserva de emergência', 100, 'Reserva', 'Pix'),

  // ───────── JANEIRO / 2027 ─────────
  I('2027-01-01', 'Salário + 13º (pago em 30/12)', 3800, 'Salário', 'pending', 'Estimativa pessimista'),
  E('2027-01-01', 'Parcela da moto', 400, 'Moto', 'Pix'),
  E('2027-01-03', 'Seguro da moto', 90, 'Moto', 'Pix'),
  E('2027-01-05', 'Unifor – 1ª mensalidade', 575, 'Faculdade', 'Boleto', 'pending', 'Desconto (345) pode começar só após 2 meses'),
  E('2027-01-07', 'Corte de cabelo', 38, 'Pessoal', 'Pix'),
  E('2027-01-11', 'Capacetes – 2/6', 92, 'Moto', 'Cartão Nubank'),
  E('2027-01-12', 'Revisão da moto – 2/2', 100, 'Moto', 'Cartão'),
  E('2027-01-15', 'Crédito celular', 35, 'Celular', 'Cartão Nubank'),
  E('2027-01-15', 'Claude Pro', 110, 'Assinaturas', 'Cartão Nubank'),
  E('2027-01-15', 'Gasolina', 175, 'Transporte', 'Pix'),
  E('2027-01-15', 'Merendas / lanches (vale iFood)', 150, 'Alimentação', 'Vale iFood'),
  E('2027-01-15', 'Lanches extras (dinheiro)', 50, 'Alimentação', 'Pix'),
  E('2027-01-18', 'Parcela da viagem', 100, 'Lazer', 'Pix'),
  E('2027-01-20', 'Parcela do celular', 335, 'Celular', 'Boleto'),
  E('2027-01-25', 'Aliança Panda – 1/3', 99.93, 'Presentes', 'Cartão'),
  E('2027-01-28', 'Reserva de emergência', 300, 'Reserva', 'Pix'),
]

export const CATEGORIES = [
  'Salário', 'Empréstimo', 'Cartão', 'Celular', 'Moto', 'Transporte', 'Alimentação',
  'Assinaturas', 'Presentes', 'Família', 'Pessoal', 'Lazer', 'Faculdade', 'Reserva', 'Outros',
]
export const METHODS = ['Vale iFood', 'Pix', 'Boleto', 'Débito', 'Cartão Nubank', 'Cartão Itaú', 'Cartão Ester', 'Cartão namorada', 'Cartão', 'Dinheiro']
