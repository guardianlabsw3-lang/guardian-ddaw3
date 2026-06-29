# 00 — Propósito do Produto

## 1. Propósito

O **PayOrder W3 Guardian** é uma solução Web3 da Guardian Labs para **geração, registro,
consulta e pagamento de cobranças** usando a rede **Stellar (Testnet)**, com registro
verificável em contrato **Soroban**.

Seu propósito é **transformar cobranças digitais em ordens de pagamento Web3
verificáveis**, com:

- destino claro e inequívoco;
- valor confirmado visualmente pelo pagador;
- registro imutável em blockchain;
- execução de pagamento direto da wallet do pagador para a wallet do tenant recebedor.

## 2. Problema que resolve

Cobranças digitais tradicionais (links de pagamento, faturas, propostas) sofrem de
**ambiguidade e baixa confiança no destino**:

1. **Destino opaco** — o pagador raramente consegue verificar, de forma confiável, *quem*
   está recebendo e *para qual conta/wallet* o dinheiro vai.
2. **Adulteração de dados** — valor, destinatário ou dados bancários podem ser alterados
   no caminho (phishing, man-in-the-middle, fraude de boleto).
3. **Falta de prova verificável** — não há um registro público e imutável de que a
   cobrança foi emitida com determinados parâmetros.
4. **Erro de digitação de destino** — quando a wallet/conta destino é digitada
   manualmente na hora da cobrança, abre-se espaço para erro humano e fraude.

O PayOrder W3 Guardian ataca esses problemas:

- A **wallet destino nunca é digitada na criação da cobrança**. Ela é resolvida
  automaticamente a partir do **tenant previamente cadastrado**, eliminando erro humano e
  troca maliciosa de destino.
- Os dados relevantes da cobrança são **serializados em payload canônico** e têm seu
  **hash SHA-256** registrado no contrato Soroban — qualquer divergência é detectável.
- O pagador vê, antes de pagar: **quem recebe, qual wallet, qual valor, qual asset, qual
  status e a prova de registro on-chain**.
- O pagamento é **não custodial**: a wallet do pagador assina diretamente no frontend; a
  seed privada do pagador **nunca** passa pelo backend.

## 3. O que o pagador deve conseguir verificar

Antes de confirmar o pagamento, o pagador deve poder confirmar visualmente:

- **quem está recebendo** (nome / razão social, documento quando aplicável);
- **qual wallet Stellar Testnet** receberá o pagamento;
- **qual valor** será transferido;
- **qual asset** será usado;
- **qual o status** da ordem (`ACTIVE`, `PAID`, `EXPIRED`, `CANCELLED`, `FAILED`);
- **se a ordem ainda está ativa**;
- **se a cobrança foi registrada corretamente em blockchain** (id da ordem, hash,
  contract id, link para o explorer da Testnet).

## 4. Princípios norteadores

| Princípio | Aplicação no produto |
|-----------|----------------------|
| **Destino confiável** | Wallet destino vem do cadastro do tenant, nunca digitada na cobrança. |
| **Verificabilidade** | Hash canônico registrado on-chain; consulta pública. |
| **Não custódia do pagador** | Seed do pagador jamais toca o backend; assinatura no frontend. |
| **Preservação histórica** | Wallet destino copiada para a Payment Order na criação. |
| **Testnet primeiro** | MVP isolado em Testnet; Mainnet é evolução futura. |
| **Simplicidade do MVP** | Arquitetura preparada para evoluir, mas escopo enxuto. |

## 5. Restrições de contexto (MVP)

- Opera **somente em Stellar Testnet**.
- **Não** considera integração com **Boleto Guardian**.
- **ERP é apenas um exemplo** de origem de cobrança, **não** uma dependência.
- A wallet principal do tenant fica **na própria tabela `tenants`** (sem tabela
  `tenant_wallets` obrigatória no MVP).
- O sistema **nunca** armazena a seed privada da wallet do **pagador**.
