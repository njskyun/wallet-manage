$(document).ready(function() { 
  // Fetch BTC price and network stats on load
  fetchBitcoinData();
  
  // Blockchain animation
  animateBlockchain();
  
  // Fetch recent blocks data
  fetchRecentBlocks();
});

// Fetch Bitcoin data from API
function fetchBitcoinData() {
  // BTC Price
  $.ajax({
    url: 'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd',
    method: 'GET',
    success: function(response) {
      if (response && response.bitcoin && response.bitcoin.usd) {
        $('#btcPrice').html(`$${numberWithCommas(response.bitcoin.usd)}`);
      } else {
        $('#btcPrice').html('数据不可用');
      }
    },
    error: function() {
      $('#btcPrice').html('数据加载失败');
    }
  });
  
  // Network Fee Estimate
  $.ajax({
    url: 'https://mempool.space/api/v1/fees/recommended',
    method: 'GET',
    success: function(response) {
      if (response && response.fastestFee) {
        $('#networkFee').html(`${response.fastestFee} sat/vB (快速)`);
        
        // Update fee rate inputs with recommended values
        $('#feeRate, #op20FeeRate').val(response.fastestFee);
      } else {
        $('#networkFee').html('数据不可用');
      }
    },
    error: function() {
      $('#networkFee').html('数据加载失败');
    }
  });
}

// Format number with commas
function numberWithCommas(x) {
  return x.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

// Animate blockchain graphic
function animateBlockchain() {
  $('.block').each(function(index) {
    const delay = index * 200;
    const block = $(this);
    
    setTimeout(function() {
      block.css({
        'animation': 'pulse 2s infinite alternate'
      });
    }, delay);
  });
}

// Show notification function
function showNotification(message, type = 'success') {
  // Remove any existing notifications
  $('.notification').remove();
  
  // Create notification
  const notification = $('<div>').addClass(`notification ${type}`).text(message);
  
  // Add to body
  $('body').append(notification);
  
  // Show notification
  setTimeout(() => notification.addClass('show'), 100);
  
  // Auto hide after 5 seconds
  setTimeout(() => {
    notification.removeClass('show');
    setTimeout(() => notification.remove(), 300);
  }, 5000);
}

// Fetch recent blocks
function fetchRecentBlocks() {
  $('#blockchainInfo').html('<div class="loading"></div> 加载最新区块数据...'); 
}