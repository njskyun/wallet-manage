import { Buffer } from 'https://cdn.jsdelivr.net/npm/buffer@6.0.3/+esm';

const savedAddress = localStorage.getItem('btcWalletAddress');

const DUST_THRESHOLD = 540;
let max_mint_number = 0
$(document).ready(function() {
  (async function populateopUtxoSelect() {
    // 1. 取出保存的地址
    if (!isWalletConnected()) {
      showNotification('请先连接钱包', 'error');
      return;
    }

    if (!savedAddress) return;
  
    // 2. 等待异步函数执行
    const utxoInputOption = await getFilteredUTXOs(savedAddress);
  
    if (utxoInputOption) { 
      max_mint_number = utxoInputOption.length;
      $("#rAddress").text('目标地址（因您的钱包只有 ' +max_mint_number+ ' 个可用UTXO，固最大可填 ' + max_mint_number + ' 个地址）'); 
    }
  })();
  
  // OP20 form submission
  $('#op20Form').on('submit', function(e) {
    e.preventDefault();
    
    // Check if wallet is connected
    if (!isWalletConnected()) {
      showNotification('请先连接钱包', 'error');
      return;
    }
    
    // Get form values
    const targetAddresses = $('#op20TargetAddresses').val().trim();
    const feeRate = $('#op20FeeRate').val().trim();
    const op20Text = $('#op20Text').val().trim();
    
    // Basic validation
    if ( !targetAddresses || !feeRate || !op20Text) {
      showNotification('请填写所有必填字段', 'error');
      return;
    }
    
    // Parse target addresses
    const addresses = parseTargetAddresses(targetAddresses);
    if (addresses.length === 0) {
      showNotification('请至少输入一个有效的目标地址', 'error');
      return;
    }
    
    // Show transaction confirmation modal
    showOp20TransactionModal({ 
      targetAddresses: addresses,
      feeRate,
      op20Text
    });
  });
});

// Show OP20 transaction confirmation modal
function showOp20TransactionModal(data) {
  
  console.log(data.targetAddresses);

  let detailsHtml = `
    <div class="transaction-preview">
      <h3 class="mb-3">OP20 交易详情</h3>
       
      <div class="transaction-detail-item">
        <span class="label">接收地址数量:</span>
        <span class="value">${data.targetAddresses.length} 个地址</span>
      </div>
      
      <div class="transaction-detail-item">
        <span class="label">费率:</span>
        <span class="value">${data.feeRate} sat/vB</span>
      </div>
       
  `;
  
  
  detailsHtml += ` 
      <div class="warning mt-3">
        <i class="fas fa-exclamation-triangle me-2"></i>
        请仔细确认所有交易详情。
      </div>
    </div>
  `;
  
  // Set modal content and show it
  $('#transactionDetails').html(detailsHtml);
  
  // Set up confirm button
  $('#confirmTransaction').off('click').on('click', function() {
    processOp20Transaction(data);
  });
  
  // Show the modal
  const transactionModal = new bootstrap.Modal(document.getElementById('transactionModal'));
  transactionModal.show();
}

// Process OP20 transaction
async function processOp20Transaction(data) {
  if (data.targetAddresses.length > max_mint_number) {
    showNotification('超过最大接收地址数量', 'error');
    return
  }

  // 计算 OP_RETURN 数据字节数 N
  let opHex = '';
  let N = 0;
  if (data.op20Text) {
      const buf = Buffer.from(data.op20Text, 'utf8');
      N = buf.length;
      opHex = buf.toString('hex');
  }

  try { 
      const utxoInputs = await getFilteredUTXOs(savedAddress);
 
      if (!utxoInputs.length) {
        showNotification('没有可用 余额', 'error');
        return
      }
      
      let hexs = []
      const len = Math.min(data.targetAddresses.length, utxoInputs.length);

      for (let i = 0; i < len; i++) {
          const utxo = utxoInputs[i];
          const targetAddress = data.targetAddresses[i];
 
          let psbt = new bitcoinjs.Psbt();

          //添加所有 UTXO 作为输入 
          psbt.addInput({
            hash: utxo.txid,
            index: parseInt(utxo.vout),
            sequence: 0xFFFFFFFD,  // 启用 RBF
            witnessUtxo: {
                script: Buffer.from(bitcoinjs.address.toOutputScript(savedAddress).toString('hex'), 'hex'),  //脚本公钥，在https://mempool.fractalbitcoin.io网站找
                value: parseInt(utxo.value)
            }
          }); 
          
          
          const ts_self = calculateChange([utxo], DUST_THRESHOLD, data.feeRate, 1, (11 + N));
          if (ts_self < 0) {
              showNotification("余额不足, 缺少：" + ts_self / 1e8, 'error');  
              continue;
          }
        
          //添加找零
          if (ts_self > 0) {    
              psbt.addOutput({ 
                  address: savedAddress,  // 接收方地址
                  value: ts_self,  // 输出金额（聪）
              });  
          } 
        
          psbt.addOutput({
              address: targetAddress,  // 接收方地址
              value: DUST_THRESHOLD,  // 输出金额（聪）
          });  
         
          // 添加 OP_RETURN
          if (opHex) psbt.addOutput({ script: Buffer.concat([Buffer.from([0x6a, N]), Buffer.from(opHex, 'hex')]), value: 0 });
        
          // const base64 = psbt.toBase64();
          // hex.push(Buffer.from(base64, 'base64').toString('hex')); 
          hexs.push(psbt.toHex());
      };
       
      // 签名与广播
      const signed = await window.unisat.signPsbts(hexs, [{ address: savedAddress }]);

      for (let i = 0; i < signed.length; i++) {
          try {
            const psbtHex = signed[i];
            // 广播当前 PSBT
            const txid = await window.unisat.pushPsbt(psbtHex);
            
            $(".record").append(`<div class="mb-3">✅ 第 ${i + 1} 笔交易广播成功，TXID: ${txid}</div>`) 
          } catch (err) { 
            $(".record").append(`<div class="mb-3">❌ 第 ${i + 1} 笔交易广播失败:` + err.message + `</div>`) 
          }
      } 
      
      // Hide modal
      const modalElement = document.getElementById('transactionModal');
      const modal = bootstrap.Modal.getInstance(modalElement);
      modal.hide();
      
    } catch (err) { 
      showNotification(err.message, 'error');
    }
}

// Add some CSS for the OP20 transaction modal
$(document).ready(function() {
  $('<style>')
    .text(`
      .op20-info {
        color: var(--text-light);
        font-size: 0.9rem;
        padding: 10px;
        background: rgba(52, 152, 219, 0.1);
        border-radius: 4px;
      }
    `)
    .appendTo('head');
});