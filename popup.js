// Copyright 2018 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

'use strict';

let launcher = document.getElementById('launcher');

launcher.onclick = function(element) {
    chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
      chrome.tabs.executeScript(
          tabs[0].id,
          {code: 'var rxjs = document.createElement("script");' +
                 'rxjs.setAttribute("src","https://unpkg.com/rxjs@6.6.2/bundles/rxjs.umd.min.js");' +
                 'document.head.appendChild(rxjs);'
          });
    });
}