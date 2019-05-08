/*
 * Copyright (c) 2017, Texas Instruments Incorporated
 * All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions
 * are met:
 *
 * *  Redistributions of source code must retain the above copyright
 *    notice, this list of conditions and the following disclaimer.
 *
 * *  Redistributions in binary form must reproduce the above copyright
 *    notice, this list of conditions and the following disclaimer in the
 *    documentation and/or other materials provided with the distribution.
 *
 * *  Neither the name of Texas Instruments Incorporated nor the names of
 *    its contributors may be used to endorse or promote products derived
 *    from this software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
 * AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO,
 * THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR
 * PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT OWNER OR
 * CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL,
 * EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO,
 * PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS;
 * OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY,
 * WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR
 * OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE,
 * EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

/*
 * gc global variable provides access to GUI Composer infrastructure components and project information.
 * For more information, please see the Working with Javascript guide in the online help.
 */

 /////////////////////////////////////////////////////////////
 // Establish connection with python server
var net = require('net');
var client = new net.Socket();
client.connect(65432, '127.0.0.1')
/////////////////////////////////////////////////////////////

var gc = gc || {};
gc.services = gc.services || {};

var maxNumSubframes = 4;
var subFrameNumInvalid = -1;
var dataframe;
var in_process1 = false;
var testframes = [];
var onPlotsTab = false;
var defaultUpdateInProgress = false;
var tprocess1; // defined later
var trytimeout = 30; //msec
var gDebugStats = 1; //enable stats collection for plots
var dataframe_start_ts = 0;
var tSummaryTab; // defined later
var visualizerVersion = '3.1.0.1';
var processedStream;
var streamWriter;
var savedStreamBytes = 0;
var savedStreamStart;
var dataFrameQueue = [];
var ConfigData;
var toolTipText= "Allowed Commands are: "
var list_of_realtime_cmds = {
    "xWR68xx": [
        "cfarCfg",
        "multiObjBeamForming",
        "clutterRemoval",
        "compRangeBiasAndRxChanPhase",
        "aoaFovCfg",
        "cfarFovCfg"
    ],
    "xWR18xx": [
        "cfarCfg",
        "multiObjBeamForming",
        "clutterRemoval",
        "compRangeBiasAndRxChanPhase",
        "aoaFovCfg",
        "cfarFovCfg"
    ],
    "xWR16xx": [
        "cfarCfg",
        "peakGrouping",
        "multiObjBeamForming",
        "extendedMaxVelocity",
        "clutterRemoval",
        "compRangeBiasAndRxChanPhase",
        "nearFieldCfg"
    ],
    "xWR14xx": [
        "cfarCfg",
        "peakGrouping",
        "multiObjBeamForming",
        "clutterRemoval",
        "compRangeBiasAndRxChanPhase"
    ]
}
var saveStreamStart = function (filename) {
    processedStream = streamSaver.createWriteStream(filename);
    streamWriter = processedStream.getWriter();
    savedStreamBytes = 0;
};
var saveStreamStop = function () {
    if (streamWriter) {
        streamWriter.close();
        streamWriter = null;
    }
};
var saveStreamAbort = function () {
    if (streamWriter) {
        streamWriter.abort('reason');
        streamWriter = null;
    }
};
var saveStreamData = function (data) {
    if (streamWriter) {
        if (savedStreamBytes == 0) {
            savedStreamStart = new Date().getTime();
        }
        streamWriter.write(data);
        savedStreamBytes += data.length;
        if ((savedStreamBytes >= (parseFloat(templateObj.$.ti_widget_textbox_record_file_size_limit.getText()) * 1024 * 1024)) ||
            (((new Date().getTime()) - savedStreamStart) > (parseInt(templateObj.$.ti_widget_textbox_record_time.getText()) * 1e3))) {
            templateObj.$.ti_widget_button_record.label = 'Record Start';
            saveStreamStop();
            updateToast('Recording has been stopped as file/time max limit has reached');
        }
    }
};

var extractDataFrame = function (dataframe_in) {
    var dataframe_process = dataframe_in.slice(0, Params.total_payload_size_bytes);
    if (initComplete === true && in_process1 === false && onPlotsTab == true && tprocess1) {
        dataFrameQueue.push(dataframe_process);
    }
    var dataframe_out = dataframe_in.slice(Params.total_payload_size_bytes, dataframe_in.length);

    return dataframe_out;
}

/*
 *  Boilerplate code for creating computed data bindings
 */
document.addEventListener('gc-databind-ready', function () {
    gc.databind.registry.getBinding('CFG_port.$rawData').addStreamingListener(cmd_sender_listener);
    //Call back to display connected device info on statusbar.
    var isConnectedBind = gc.databind.registry.getBinding('CFG_port.$target_connected');
    isConnectedBind.addChangedListener({
        onValueChanged: function() {
            if (isConnectedBind.getValue()) {
                cmd_sender_listener.askVersion(function(error, mesg) {
                });
            }
            else{
                templateObj.$.ti_widget_statusbar.statusString3 = '';
            }
            
        }
    });
    gc.databind.registry.getBinding('DATA_port.$rawData').addStreamingListener({
        onDataReceived: function (data) {
            if (data) {
                //console.log('  ... $rawData !! ' + (data ? data.length : 'nothing'));
                if (Params) {
                    var numDataFrameAdded = 0;
                    // start with saving the data, if user has requested it
                    saveStreamData(data);
                    //Now check if we append to dataframe or create a new dataframe
                    if (dataframe) {
                        Array.prototype.push.apply(dataframe, data);
                    } else {
                        if (data.length >= 8 + 4 + 4 && isMagic(data, 0)) {
                            dataframe = data.slice(0);
                        }
                    }
                    // Now split the accumulated dataframe into bytevec that can be given to process1
                    while (dataframe.length > 0) {
                        // start of the remainder dataframe should start with magic else drop the accumulated frame
                        if (dataframe.length >= 8 + 4 + 4 && isMagic(dataframe, 0)) {
                            Params.total_payload_size_bytes = totalFrameSize(dataframe, 8 + 4);
                        } else {
                            dataframe = [];
                            Params.total_payload_size_bytes = 0;
                        }
                        if (dataframe.length >= Params.total_payload_size_bytes) {
                            // this function will push one bytevec worth of data to the queue and return remaining bytes 
                            dataframe = extractDataFrame(dataframe);
                            numDataFrameAdded++;
                        }
                        else {
                            break;
                        }
                    }
                    // Now check if we have bytevec's queued up
                    if (dataFrameQueue.length > 0 && initComplete === true) {
                        if (in_process1 === false && onPlotsTab == true && tprocess1) {
                            try {
                                var cnt;
                                if (Params.plot) {
                                    if (Params.plot.dataFrames > 0) {
                                        gatherParamStats(Params.plot.dataStats, getTimeDiff(dataframe_start_ts));
                                    }
                                    dataframe_start_ts = getTimeDiff(0);
                                    Params.plot.dataFrames++;
                                }
                                in_process1 = true;
                                //if we added more than one bytevec in this run, we should queue it up for process1
                                //else let data interrupts help drain the queue
                                for (cnt = 0; cnt < numDataFrameAdded; cnt++) {
                                    var dataframe_process = dataFrameQueue.shift();
                                    if (dataframe_process && dataframe_process.length > 0) {
                                        tprocess1(dataframe_process);
                                    }
                                }
                            } finally {
                                in_process1 = false; // need to refactor, the global Params is not a good idea. we may hit exception when changing global Params and so in_process1 never flipped to false
                            }
                        }
                    }

                }
            }
        }
    });
    extendAboutBox();
});

/*
 *  Boilerplate code for creating custom actions
 */
document.addEventListener('gc-nav-ready', function () {
    /* 
     *   Add custom actions for menu items using the following api:
     *
     *   function gc.nav.registryAction(id, runable, [isAvailable], [isVisible]);
     *
     *   param id - uniquely identifies the action, and should correspond to the action property of the menuaction widget.
     *   param runable - function that performs the custom action.
     *   param isAvailable - (optional) - function called when the menu action is about to appear.  Return false to disable the action, or true to enable it.
     *   param isVisible - (optional) - function called when the menu action is about to appear.  Return false to hide the action, or true to make it visible.
     */

    // For example,
    // gc.nav.registerAction('myCustomCloseAction', function() { window.close(); }, function() { return true; }, function() { return true; });

    // Alternatively, to programmatically disable a menu action at any time use:
    // gc.nav.disableAction('myCustomCloseAction);    then enable it again using:  gc.nav.enableAction('myCustomCloseAction'); 

    //MMWSDK-895 user app's url to obtain the download link
    gc.nav.registerAction('ti_widget_menuaction_download', {
        run: function () {
            var urlChange = window.location.href;
            var permanentID = '/view/';
            var v1 = urlChange.lastIndexOf('/ver/');
            if(urlChange.lastIndexOf('default') > 0){
                var v2 = urlChange.lastIndexOf('default')+8;
            } else {
                var v2 = urlChange.lastIndexOf(permanentID)+(permanentID.length);
            }
            var projectname = urlChange.substring(v2,v1);
            var url = "https://dev.ti.com/gallery/info/"+ projectname + "//"
            window.open(url, '_blank');
        },
        isAvailable: function () {
            return true;
        },
        isVisible: function () {
            return true;
        }
    });
    gc.nav.registerAction('ti_widget_menuaction_userguide', {
        run: function () {
            window.open('http://www.ti.com/lit/pdf/swru529', '_blank');
        },
        isAvailable: function () {
            return true;
        },
        isVisible: function () {
            return true;
        }
    });
});

/*
 *  Boilerplate code for working with components in the application gist
 */


var initComplete = false;
var templateObj;

// Wait for DOMContentLoaded event before trying to access the application template
var init = function () {
    templateObj = document.querySelector('#template_obj');

    // Wait for the template to fire a dom-change event to indicate that it has been 'stamped'
    // before trying to access components in the application.
    if (templateObj) {
        templateObj.addEventListener('dom-change', function () {
            if (initComplete) return;
            this.async(function () {
                initComplete = true;
                console.log("Application template has been stamped.");
                // Now that the template has been stamped, you can use 'automatic node finding' $ syntax to access widgets.
                // e.g. to access a widget with an id of 'widget_id' you can use templateObj.$.widgetId
                var slow = checkBrowser();
                if (slow) trytimeout = 250; //msec
                tprocess1 = MyUtil.foo(trytimeout, process1);
                tSummaryTab = MyUtil.foo(1000, function (subset) {
                    if (templateObj.$.ti_widget_tabcontainer_summarytabs.selectedLabel == subset) {
                        onSummaryTab();
                    }
                });
                onResetProfile();
                setupPlots(validationsCfg.parseCfg(mmwInput.generateCfg().lines, mmwInput.Input.platform, mmwInput.Input.sdkVersionUint16));
                onSummaryTab();
                templateObj.$.ti_widget_button_start_stop.disabled = true;
                templateObj.$.ti_widget_slider_range_resolution._valueChanged = onRangeResolution;
                templateObj.$.ti_widget_slider_max_range._valueChanged = onMaxRange;
                templateObj.$.ti_widget_slider_max_radial_vel._valueChanged = onMaxRadialVel;
                templateObj.$.ti_widget_slider_frame_rate._valueChanged = onFrameRate;
                var query = window.location.search;
                if (query && query.length > 1) {
                    if (query[0] == '?') query = query.slice(1);
                    var tmp = query.split('&');
                    for (var idx = 0; idx < tmp.length; idx++) {
                        if (tmp == 'debug=true') {
                            debug_mode = 1;
                        }
                    }
                }
                templateObj.$.ti_widget_tabcontainer_main.addEventListener('selected-index-changed', function (a, b, c) {
                    onPlotsTab = templateObj.$.ti_widget_tabcontainer_main.selectedIndex == 1; // not sufficient for being responsive
                });
                onPlotsTab = templateObj.$.ti_widget_tabcontainer_main.selectedIndex == 1; // reflect the fact after dom is fully initialized.
                conditionalAutoConnect();
                templateObj.$.ti_widget_tabcontainer_summarytabs.addEventListener("tab_click",function(event){
                    var subset= 'Profiling';
                    if(event.detail.tabIndex == 1 ){
                        subset= 'Chirp/Frame';
                    } else if(event.detail.tabIndex == 2){
                        subset= 'Scene';
                    }
                    onSummaryTab(subset);
                });
                //checkBrowser();
            }, 1);

        });
    }
};
function helptxtchange() {
    var platform = '';
    if(ConfigData === undefined){
        platform = mmwInput.Input.platform;
    } else {
        platform = ConfigData.platform;
    }
    if(platform === 'xWR16xx'){ 
        helpText.open();
    } else if (platform === 'xWR14xx'){
        helpText2.open();
    }
    else if(platform === 'xWR68xx'){
        helpText3.open();
    }
    else if(platform === 'xWR18xx'){
        helpText4.open();
    }

}

function onHoverTxtChange() {
    var platform = '';
    if(ConfigData === undefined){
        platform = mmwInput.Input.platform;
    } else {
        platform = ConfigData.platform;
    }
    var hooverlist = list_of_realtime_cmds;
    if ((platform === 'xWR14xx')||
        (platform === 'xWR16xx')|| 
        (platform === 'xWR18xx')|| 
        (platform === 'xWR68xx')) 
    {
        templateObj.$.ti_widget_container_textbox_dyn.tooltip= toolTipText + list_of_realtime_cmds[platform];
    } 
    else {
        templateObj.$.ti_widget_container_textbox_dyn.tooltip = "Unknown platform";
    }
}

templateObj = document.querySelector('#template_obj');
if (templateObj) {
    init();
} else {
    document.addEventListener('DOMContentLoaded', init.bind(this));
}

var extendAboutBox = function () {
    var aboutBox = document.querySelector('ti-widget-aboutbox');
    if (aboutBox) {
        aboutBox.addEventListener('aboutbox_opening', function (event) {
            aboutBox.appInfoTextHeading = 'Details';
            aboutBox.softwareManifestLink = "app/docs/mmwave_demo_visualizer_software_manifest.html";
            var str = '******************************\nmmWave Demo Visualizer\n******************************\n';
            str = str + 'Version                 : ';
            str = str + visualizerVersion + '\n';
            str = str + 'Publish Date            : 12/19/2018\n';
            str = str + 'Compatible SDK Versions : mmWave SDK 3.1.0, mmWave SDK 3.0.0, mmWave SDK 2.1.0, mmWave SDK 2.0.0, mmWave SDK 1.2.0\n';
            str = str + '\n';
            str = str + 'Change List\n';
            str = str + '  04/26/2017: First version \n';
            str = str + '  06/21/2017: Updated Help->About \n';
            str = str + '  09/12/2017: Updates for mmWave SDK 1.1.0 \n';
            str = str + '  09/12/2017: Added capability to record UART stream while plotting \n';
            str = str + '  11/29/2017: Bug Fix: Incorrect platform used when loading profile from plots tab \n';
            str = str + '  03/09/2018: Added support for SDK 1.2 based additional CLI params \n';
            str = str + '  03/19/2018: Added support for SDK 2.0\n';
            str = str + '  03/28/2018: Added check for low Power command\n';
            str = str + '  04/11/2018: Bug Fix: Refresh scatter plot when legacy frame has no detected object.\n';
            str = str + '  07/06/2018: Bug Fix: Updated the azimuth resolution printed value in degress for 2rx, 1Tx case\n';
            str = str + '  07/06/2018: Bug Fix: Updated the RCS related calculations\n';
            str = str + '  07/09/2018: Added dynamic command and real-time tunning features in the plots tab.\n';
            str = str + '              Code refactored and input_validations.js, dynamic_tunning.js files created\n';
            str = str + '              Added support for SDK 2.1\n';
            str = str + '  07/13/2018: xwr14xx lpAdcMode is enabled by default.\n';
            str = str + '  09/24/2018: Removed support for SDK versions 1.0 and 1.1.\n';
            str = str + '  09/28/2018: Fix values for non-coherent combining loss for NvirtAnt=12.\n';
            str = str + '  09/29/2018: Added support for SDK version 3.0 and xWR68xx platform.\n';
            str = str + '  10/30/2018: Added support for SDK version 3.1 and xWR18xx platform.\n';
            str = str + '  11/30/2018: Added plot settings feature in the plots tab.\n';
            str = str + '  12/03/2018: Disabled range azimuth heatmap checkbox when 1RX/1TX antenna configuration is selected.\n';            
            str = str + '\n';
            str = str + '******************************\nConnected device\n******************************\n';
            aboutBox.appInfoText = str + 'Retreiving version information ...\nPlease connect hardware';
            aboutBox.numRowsInAppInfoTextArea = 16;
            cmd_sender_listener.askVersion(function (error, mesg) {
                if (mesg) aboutBox.appInfoText = str + mesg;
            });
        });
    }
};

var mmwInput = new mmWaveInput();
var validationsCfg = new validations();

var onFreqBand = function () {
    if (defaultUpdateInProgress === false) {
        mmwInput.updateInput({ Frequency_band: parseFloat(templateObj.$.ti_widget_droplist_freq_band.selectedValue, 10) });
    }
};
var onPlatform = function () {
    if (defaultUpdateInProgress === false) {
        updateFreqBandList(templateObj.$.ti_widget_droplist_platform.selectedValue);
        updateSDKVersionList(templateObj.$.ti_widget_droplist_platform.selectedValue);
        mmwInput.updateInput({ platform: templateObj.$.ti_widget_droplist_platform.selectedValue });
        showHideDopplerSettings();
        showHideFovSettings();
        updateAzimuthResList();
        reflectDroplist(templateObj.$.ti_widget_droplist_azimuth_resolution, mmwInput.Input.Azimuth_Resolution);
        showHideStaticClutterSettings();
    }
};
var onSubprofile = function () {
    // call updateInput to switch the units of sliders (since the units are different across sub-profiles)
    mmwInput.updateInput({ subprofile_type: templateObj.$.ti_widget_droplist_subprofile.selectedValue });
    // call this once to reset the min/max of sliders as per default. This causes values of sliders to set 
    // as per min/max of the sliders and not what we want the default to be
    setSubProfileDefaults(templateObj.$.ti_widget_droplist_subprofile.selectedValue);
    // call this again to now reset the values of the sliders
    setSubProfileDefaults(templateObj.$.ti_widget_droplist_subprofile.selectedValue);
};
var onFrameRate = function () {
    if (defaultUpdateInProgress === false) {
        mmwInput.updateInput({ Frame_Rate: Math.abs(templateObj.$.ti_widget_slider_frame_rate.value) });
    }
};
var onAzimuthResolution = function () {
    if (defaultUpdateInProgress === false) {
        templateObj.$.ti_widget_statusbar.showToastMessage('Advice:', 2000, 'Please reboot the sensor if sensor has been configured with different Azimuth resolution after powerUp', null, 100); //MMWSDK-518
        mmwInput.updateInput({ Azimuth_Resolution: templateObj.$.ti_widget_droplist_azimuth_resolution.selectedValue });
    }
    
    //Azimuth heatmap checkbox should be disabled when 1RX/1TX is selected
    if (ti_widget_droplist_azimuth_resolution.selectedValue == 'None (1Rx/1Tx)') {
        ti_widget_checkbox_azimuth_heatmap.$.checkbox.disabled = true;
        ti_widget_checkbox_azimuth_heatmap.checked = false;
    } else {
        ti_widget_checkbox_azimuth_heatmap.$.checkbox.disabled = false;
    }
};
var onSDKVersionChange = function () {
    if (defaultUpdateInProgress === false) {
        mmwInput.updateInput({ sdkVersionUint16: parseInt(templateObj.$.ti_widget_droplist_sdk_version.selectedValue, 16) });
    }
};
var onRangeResolution = function () {
    if (defaultUpdateInProgress === false) {
        if (mmwInput.isRR(mmwInput.Input)) {
            // value = ramp_slope (MHz/us): [5, 100], with increments of 5
            mmwInput.updateInput({ Ramp_Slope: templateObj.$.ti_widget_slider_range_resolution.value }); // for RR
        } else if (mmwInput.isVR(mmwInput.Input)) {
            // total bandwidth [0.5:0.5:4] GHz
            mmwInput.updateInput({ Bandwidth: templateObj.$.ti_widget_slider_range_resolution.value }); // for VR
        } else if (mmwInput.isBestRange(mmwInput.Input)) {
            // select Number of ADC Samples N_ADC  for best range
            mmwInput.updateInput({ Num_ADC_Samples: templateObj.$.ti_widget_slider_range_resolution.value }); // for RR
        }
    }
};
var onMaxRange = function () {
    if (defaultUpdateInProgress === false) {
        if (mmwInput.isRR(mmwInput.Input) || mmwInput.isBestRange(mmwInput.Input)) {
            // for RR, for best range
            mmwInput.updateInput({ Maximum_range: MyUtil.toPrecision(templateObj.$.ti_widget_slider_max_range.value, 2) });
        } else if (mmwInput.isVR(mmwInput.Input)) {
            mmwInput.updateInput({ Num_ADC_Samples: templateObj.$.ti_widget_slider_max_range.value });
        }
    }
};
var onMaxRadialVel = function () {
    if (defaultUpdateInProgress === false) {
        if (mmwInput.isRR(mmwInput.Input) || mmwInput.isBestRange(mmwInput.Input)) {
            mmwInput.updateInput({ Maximum_radial_velocity: MyUtil.toPrecision(templateObj.$.ti_widget_slider_max_radial_vel.value, 2) });
        } else if (mmwInput.isVR(mmwInput.Input)) {
            mmwInput.updateInput({ Doppler_FFT_size: 1 << templateObj.$.ti_widget_slider_max_radial_vel.value }); // the widget choices log2(N_fft2d);
        }
    }
};
var onRadialVelResolution = function () {
    if (defaultUpdateInProgress === false) {
        if (mmwInput.isRR(mmwInput.Input) || mmwInput.isBestRange(mmwInput.Input)) {
            //mmwInput.updateInput({N_fft2d: parseInt(templateObj.$.ti_widget_droplist_radial_vel_resolution.selectedValue, 10)});
            mmwInput.updateInput({ Doppler_FFT_size: parseInt(templateObj.$.ti_widget_droplist_radial_vel_resolution.selectedValue, 10) });
        }
    }
};
var onRCS = function () {
    //TODO RCS_desired
    // want Truck (100) Car (10), Motocyle (3.2) Adult (1), and any other user entered value
    if (defaultUpdateInProgress === false) {
        var tmp = parseFloat(templateObj.$.ti_widget_textbox_rcs_desired.getText());
        if (isNaN(tmp) === false) {
            mmwInput.updateInput({ RCS_desired: Math.abs(tmp) });
        }
    }
};
var onRangeSensitivity = function () {
    if (defaultUpdateInProgress === false) {
        var tmp = parseFloat(templateObj.$.ti_widget_textbox_range_sensitivity.getText());
        if (isNaN(tmp) === false) {
            if (tmp < 0 || tmp > 100) {
                tmp = Math.max(0, Math.min(100, tmp));
                templateObj.$.ti_widget_textbox_range_sensitivity.setText(tmp);
            }
            mmwInput.updateInput({ Range_Sensitivity: Math.abs(tmp) });
        }
    }
};
var onDopplerSensitivity = function () {
    if (defaultUpdateInProgress === false) {
        var tmp = parseFloat(templateObj.$.ti_widget_textbox_doppler_sensitivity.getText());
        if (isNaN(tmp) === false) {
            if (tmp < 0 || tmp > 100) {
                tmp = Math.max(0, Math.min(100, tmp));
                templateObj.$.ti_widget_textbox_doppler_sensitivity.setText(tmp);
            }
            mmwInput.updateInput({ Doppler_Sensitivity: Math.abs(tmp) });
        }
    }
};
var onRecordPause = function () {

    var cmd = templateObj.$.ti_widget_button_record.label;
    var next;
    var platform = 'xwr16xx';
    if (cmd == 'Record Start') {
        next = 'Record Stop';
        var dateAppendStr = (new Date().toISOString().replace(/[-:\.]/g, "_").replace(/[Z]/g, ""));
        if (Params) {
            if (Params.platform == mmwInput.Platform.xWR14xx) {
                platform = 'xwr14xx';
            }
            else if (Params.platform == mmwInput.Platform.xWR18xx) {
                platform = 'xwr18xx';
            }
            else if (Params.platform == mmwInput.Platform.xWR68xx) {
                platform = 'xwr68xx';
            }
            saveStreamStart(platform + '_processed_stream_' + dateAppendStr + '.dat');
        } else {
            saveStreamStart('processed_stream_' + dateAppendStr + '.dat');
        }

    } else if (cmd == 'Record Stop') {
        next = 'Record Start';
        saveStreamStop();
    }
    templateObj.$.ti_widget_button_record.label = next;

};

var showHideStaticClutterSettings = function () {
    var value = 'block';
    if (mmwInput.Input.sdkVersionUint16 == 0x0100) {
        value = 'none';
    }
    templateObj.$.ti_widget_checkbox_clutter_removal.style.display = value;
    templateObj.$.ti_widget_label_Algo.style.display = value;
};

var showHideDopplerSettings = function () {
    var value = 'block';
    if (mmwInput.Input.platform == mmwInput.Platform.xWR14xx) {
        value = 'none';
    }
    templateObj.$.ti_widget_label_doppler_range_threshold.style.display = value;
    templateObj.$.ti_widget_slider_doppler_range_threshold.style.display = value;

};
var showHideDopplerSettingsOnLoad = function (platform) {
    var value = 'block';
    if (platform == 'xWR14xx') {
        value = 'none';
    }
    templateObj.$.ti_widget_label_doppler_range_threshold.style.display = value;
    templateObj.$.ti_widget_slider_doppler_range_threshold.style.display = value;

};

var showHideFovSettingsOnLoad = function(platform) {
    var value = 'block';
    if ((platform == 'xWR14xx') || (platform == 'xWR16xx')) {
        value = 'none';
    }
    if ((platform == 'xWR68xx')||(platform == 'xWR18xx')) {
        value = 'block';
    }
   
    templateObj.$.ti_widget_container_fov_commands.style.display = value;
};
var showHideFovSettings = function() {
    var value = 'block';
    if ((mmwInput.Input.platform == mmwInput.Platform.xWR14xx) ||
        (mmwInput.Input.platform == mmwInput.Platform.xWR16xx)) {
        value = 'none';
    }
    if ((mmwInput.Input.platform == mmwInput.Platform.xWR18xx)||
        (mmwInput.Input.platform == mmwInput.Platform.xWR68xx))
    {
        value = 'block';
    }
    templateObj.$.ti_widget_container_fov_commands.style.display = value;
};
var updateAzimuthResList = function () {
    var azimuth_res_values = ['15', '30', '60', 'None (1Rx/1Tx)'];
    var azimuth_res_labels = ['4Rx,2Tx(15 deg)', '4Rx,1Tx(30 deg)', '2Rx,1Tx(60 deg)', '1Rx,1Tx(None)'];

    if ((mmwInput.Input.platform == mmwInput.Platform.xWR14xx) ||
        (mmwInput.Input.platform == mmwInput.Platform.xWR18xx) ||
        (mmwInput.Input.platform == mmwInput.Platform.xWR68xx))
         {
        azimuth_res_values = ['15 + Elevation', '15', '30', '60', 'None (1Rx/1Tx)'];
        azimuth_res_labels = ['4Rx,3Tx(15 deg + Elevation)', '4Rx,2Tx(15 deg)', '4Rx,1Tx(30 deg)', '2Rx,1Tx(60 deg)', '1Rx,1Tx(None)'];
    }
    else if (mmwInput.Input.platform == mmwInput.Platform.xWR16xx) 
    {
        if (mmwInput.Input.Azimuth_Resolution == '15 + Elevation') {
            mmwInput.Input.Azimuth_Resolution = '15';
        }
    }
    templateObj.$.ti_widget_droplist_azimuth_resolution.values = azimuth_res_values.join('|');
    templateObj.$.ti_widget_droplist_azimuth_resolution.labels = azimuth_res_labels.join('|');

    reflectDroplist(templateObj.$.ti_widget_droplist_azimuth_resolution, mmwInput.Input.Azimuth_Resolution);
};


var updateFreqBandList = function (platform) {
    var freqBand_values = ['76', '77'];
    var freqBand_labels = ['76-77', '77-81'];

    if (platform == mmwInput.Platform.xWR68xx)
    {
        freqBand_values = ['60.25'];
        freqBand_labels = ['60.25-64'];
        mmwInput.Input.Frequency_band = '60.25';
    } 
    else 
    {
        mmwInput.Input.Frequency_band = '77';
    }

    templateObj.$.ti_widget_droplist_freq_band.values = freqBand_values.join('|');
    templateObj.$.ti_widget_droplist_freq_band.labels = freqBand_labels.join('|');

    reflectDroplist(templateObj.$.ti_widget_droplist_freq_band, mmwInput.Input.Frequency_band);
};

var updateSDKVersionList = function (platform) {
    var sdkversion_values = ['0x0102', '0x0200', '0x0201'];
    var sdkversion_labels = ['1.2', '2.0', '2.1'];
    

    if (platform == mmwInput.Platform.xWR68xx)
    {
        sdkversion_values = ['0x0300','0x0301'];
        sdkversion_labels = ['3.0','3.1'];
        mmwInput.Input.sdkVersionUint16 = 0x0301;
    } 
    else if (platform == mmwInput.Platform.xWR18xx)
    {
        sdkversion_values = ['0x0301'];
        sdkversion_labels = ['3.1'];
        mmwInput.Input.sdkVersionUint16 = 0x0301;
    }
    else 
    {
        mmwInput.Input.sdkVersionUint16 = 0x0201;
    }

    templateObj.$.ti_widget_droplist_sdk_version.values = sdkversion_values.join('|');
    templateObj.$.ti_widget_droplist_sdk_version.labels = sdkversion_labels.join('|');

    reflectDroplist(templateObj.$.ti_widget_droplist_sdk_version, mmwInput.Input.sdkVersionUint16);
};


var reflectDroplist = function (widget, newValue) {
    if (newValue && widget.selectedValue != newValue) {
        widget.selectedValue = newValue;
        return true;
    }
    return false;
};
var reflectTextbox = function (widget, newValue) {
    if (newValue && widget.getText() != newValue) {
        widget.setText(newValue);
        return true;
    }
    return false;
};
var reflectSlider = function (widget, newValue) {
    if (newValue && widget.value != newValue) {
        widget.value = newValue;
        return true;
    }
    return false;
};
var reflectCheckbox = function (widget, newValue) {
    //if (newValue && widget.checked != newValue) {
    widget.checked = newValue;
    return true;
    //}
    //return false;
};
var setSliderDefaults = function () {
    if (reflectDroplist(templateObj.$.ti_widget_droplist_platform, mmwInput.Input.platform)) {
        showHideDopplerSettings();
        updateAzimuthResList();
    }
    updateFreqBandList(mmwInput.Input.platform);
    updateSDKVersionList(mmwInput.Input.platform);
    reflectDroplist(templateObj.$.ti_widget_droplist_freq_band, mmwInput.Input.Frequency_band);
    reflectDroplist(templateObj.$.ti_widget_droplist_subprofile, mmwInput.Input.subprofile_type);
    //reflectTextbox(templateObj.$.ti_widget_textbox_frame_rate, mmwInput.Input.Frame_Rate);
    reflectSlider(templateObj.$.ti_widget_slider_frame_rate, mmwInput.Input.Frame_Rate);
    reflectDroplist(templateObj.$.ti_widget_droplist_azimuth_resolution, mmwInput.Input.Azimuth_Resolution);
    if (mmwInput.isRR(mmwInput.Input)) {
        reflectSlider(templateObj.$.ti_widget_slider_range_resolution, mmwInput.Input.Ramp_Slope);
    } else if (mmwInput.isVR(mmwInput.Input)) {
        reflectSlider(templateObj.$.ti_widget_slider_range_resolution, mmwInput.Input.Bandwidth);
    } else if (mmwInput.isBestRange(mmwInput.Input)) {
        reflectSlider(templateObj.$.ti_widget_slider_range_resolution, mmwInput.Input.Num_ADC_Samples);
    }
    if (mmwInput.isRR(mmwInput.Input) || mmwInput.isBestRange(mmwInput.Input)) {
        reflectSlider(templateObj.$.ti_widget_slider_max_range, mmwInput.Input.Maximum_range);
        reflectSlider(templateObj.$.ti_widget_slider_max_radial_vel, mmwInput.Input.Maximum_radial_velocity);
        reflectDroplist(templateObj.$.ti_widget_droplist_radial_vel_resolution, mmwInput.Input.Doppler_FFT_size);
    } else if (mmwInput.isVR(mmwInput.Input)) {
        reflectSlider(templateObj.$.ti_widget_slider_max_range, mmwInput.Input.Num_ADC_Samples);
        reflectSlider(templateObj.$.ti_widget_slider_max_radial_vel, Math.log2(mmwInput.Input.Doppler_FFT_size));
        //templateObj.$.ti_widget_droplist_radial_vel_resolution should be covered by Input.velocityResolutionConstraints2 but need to check after refactorig.
    }
    reflectTextbox(templateObj.$.ti_widget_textbox_rcs_desired, mmwInput.Input.RCS_desired);
    // reflectTextbox(templateObj.$.ti_widget_textbox_range_sensitivity, mmwInput.Input.Range_Sensitivity);
    // reflectTextbox(templateObj.$.ti_widget_textbox_doppler_sensitivity, mmwInput.Input.Doppler_Sensitivity);// even it is hidden updating it should not hurt
    /* MMWSDK-581 */
    reflectCheckbox(templateObj.$.ti_widget_checkbox_grouppeak_rangedir, true);
    reflectCheckbox(templateObj.$.ti_widget_checkbox_grouppeak_dopplerdir, true);
    reflectCheckbox(templateObj.$.ti_widget_checkbox_scatter_plot, true);
    reflectCheckbox(templateObj.$.ti_widget_checkbox_range_profile, true);
    reflectCheckbox(templateObj.$.ti_widget_checkbox_noise_profile, false);
    reflectCheckbox(templateObj.$.ti_widget_checkbox_azimuth_heatmap, false);
    reflectCheckbox(templateObj.$.ti_widget_checkbox_doppler_heatmap, false);
    reflectCheckbox(templateObj.$.ti_widget_checkbox_statistics, true);
    reflectCheckbox(templateObj.$.ti_widget_checkbox_clutter_removal, false); //check name
    showHideStaticClutterSettings();
    showHideFovSettings();
    /* MMWSDK-581 */

}

var onResetProfile = function () {
    // call this once to reset the min/max of sliders as per default. This causes values of sliders to set 
    // as per min/max of the sliders and not what we want the default to be
    setSubProfileDefaults(mmwInput.Input.subprofile_type);
    // call this again to now reset the values of the sliders
    setSubProfileDefaults(mmwInput.Input.subprofile_type);
}
var setSubProfileDefaults = function (subprofile_type) {
    if (subprofile_type == 'best_range_res') {
        mmwInput.setDefaultRangeResConfig(mmwInput.Input);
    } else if (subprofile_type == 'best_vel_res') {
        mmwInput.setDefaultVelResConfig(mmwInput.Input);
    } else if (subprofile_type == 'best_range') {
        mmwInput.setDefaultRangeConfig(mmwInput.Input);
    } else {
        mmwInput.setDefaultRangeResConfig(mmwInput.Input);
    }
    // disable the continuous calling of updateInput while we adjust the sliders
    // to the values we desire
    defaultUpdateInProgress = true;
    setSliderDefaults();
    defaultUpdateInProgress = false;
    mmwInput.updateInput({});
    // call this again to set the values as per updateInput constraints
    setSliderDefaults();
};

var onSendCommand = function () {
    templateObj.$.ti_widget_label_status_message.visible = false;
    if (!checkSerialPort()) return;
    cmd_sender_listener.askVersion(function (error, mesg) {
        var isError;

        //Check reported platform against that selected by user and generate error
        //if mismatched
        var platform = mesg.match(/Platform\s*:\s*(\S*)/);
        isError = false;
        if (platform[1] == null) {
            errorMesg = "SDK Platform not reported by target";
            isError = true;
        } 
        else {
            if (platform[1] != mmwInput.Input.platform) {
                errorMesg = "Selected Platform [" +
                    mmwInput.Input.platform +
                    "] not matching that reported by target [" +
                    platform[1] + "].";
                isError = true;
            }
        }

        if (isError == true) {
            templateObj.$.ti_widget_label_status_message.label = errorMesg;
            templateObj.$.ti_widget_label_status_message.visible = true;
            templateObj.$.ti_widget_label_status_message.fontColor = "#ff0000";
            return;
        }

        //Check reported SDK version against that selected by user and generate error
        //if mismatched
        var sdkVer = mesg.match(/mmWave SDK Version\s*:\s*(\S*)/);
        isError = false;
        if (sdkVer[1] == null) {
            errorMesg = "SDK Version not reported by target";
            isError = true;
        } 
        else {
            var sdkVerSplit = sdkVer[1].split(".").map(Number);
            if (sdkVerSplit.length == 4 /* major + minor + bugfix + build */) {
                var sdkVerUint16 = (sdkVerSplit[0] << 8) | sdkVerSplit[1];
                if (sdkVerUint16 != mmwInput.Input.sdkVersionUint16) {
                    errorMesg = "SDK input version [major,minor] = [" +
                        ((mmwInput.Input.sdkVersionUint16 >> 8) & 0xF).toString() + "," +
                        (mmwInput.Input.sdkVersionUint16 & 0xF).toString() + "] not matching [" +
                        sdkVerSplit[0] + "," + sdkVerSplit[1] +
                        "] reported by target, Hint: Change input version/target and try again";
                    isError = true;
                }
            }
             else {
                errorMesg = "SDK version length reported by target is not matching expected four elements";
                isError = true;
            }
        }
  
        //Get values from config tab and assign to cfar sliders, peakgrouping and clutter removal 
        var cfarDetectionThresholdVal = mmwInput.Input.Range_Sensitivity;
        if (cfarDetectionThresholdVal) {
            templateObj.$.ti_widget_slider_cfar_range_threshold.value = cfarDetectionThresholdVal;
        } else {
            errorMesg = "Range threshold value is invalid.";
            isError = true;
        }

        //Get Range detection value from config tab and assign to cfar slider 
        var dopplerDetectionThresholdVal = mmwInput.Input.Doppler_Sensitivity;
        if (dopplerDetectionThresholdVal) {
            templateObj.$.ti_widget_slider_doppler_range_threshold.value = dopplerDetectionThresholdVal;
        } else {
            errorMesg = "Doppler threshold value is invalid.";
            isError = true;
        }

        templateObj.$.ti_widget_checkbox_clutter_removal.checked = false;
        templateObj.$.ti_widget_checkbox_grouppeak_rangedir.checked = true;
        templateObj.$.ti_widget_checkbox_grouppeak_dopplerdir.checked = true;

        if (isError == true) {
            templateObj.$.ti_widget_label_status_message.label = errorMesg;
            templateObj.$.ti_widget_label_status_message.visible = true;
            templateObj.$.ti_widget_label_status_message.fontColor = "#ff0000";
            return;
        }

        var cfg = mmwInput.generateCfg();
        // Get values from lines onSend() and populates cfarFov, aoaFovCfg commands values to textboxes in Real TIme tuning window 
        if (cfg.lines) {
            var lines = cfg.lines;
            lines.forEach(function(item, index) {
                var splittedValue = item.split(" ");
                //For aoaFovCfg
                if (item.indexOf("aoaFovCfg ") > -1) {
                    templateObj.$.ti_widget_textbox_azimuth_min.value = splittedValue[2];
                    templateObj.$.ti_widget_textbox_azimuth_max.value = splittedValue[3];
                    templateObj.$.ti_widget_textbox_elevation_min.value = splittedValue[4];
                    templateObj.$.ti_widget_textbox_elevation_max.value = splittedValue[5];
                }

                //For cfarfov range
                if (item.indexOf("cfarFovCfg ") > -1) {

                    //For range
                    if (splittedValue[2] == '0') {
                        templateObj.$.ti_widget_textbox_range_fov_min.value = splittedValue[3];
                        templateObj.$.ti_widget_textbox_range_fov_max.value = splittedValue[4];

                    }

                    // For doppler.
                    if (splittedValue[2] == '1') {
                        templateObj.$.ti_widget_textbox_doppler_fov_min.value = splittedValue[3];
                        templateObj.$.ti_widget_textbox_doppler_fov_max.value = splittedValue[4];
                    }

                }


            });

        }
        sendCmdAndSetupPlots(cfg.lines, mmwInput.Input.platform, mmwInput.Input.sdkVersionUint16);
    });
};


var onSaveCfg = function () {
    var cfg = mmwInput.generateCfg();
    var delim = '\n';
    var tmp = window.navigator.platform;
    if (tmp) {
        tmp = tmp.toLowerCase();
        if (tmp.indexOf('win') >= 0) delim = '\r\n';
    }
    var data = cfg.lines.join(delim);
    gc.File.saveBrowserFile(data, { filename: 'profile.cfg' }, function (e1) {
        // don't have any callback
    });
};
//MMWSDK-528
var checkFrameRateAndPlotSelection = function (P) {
    var numPlots = 0;
    var subFrameNum = P.subFrameToPlot;
    var periodicity = getFramePeriodicty(subFrameNum);

    if (P.guiMonitor[subFrameNum].detectedObjects > 0) numPlots++;
    if (P.guiMonitor[subFrameNum].logMagRange == 1) numPlots++;
    if (P.guiMonitor[subFrameNum].noiseProfile == 1) numPlots++;

    if (periodicity <= 40 && numPlots > 1) {
        templateObj.$.ti_widget_label_status_message.label = "Warning: Try reducing the number of plots or reducing the frame rate for better performance";
        templateObj.$.ti_widget_label_status_message.visible = true;
        templateObj.$.ti_widget_label_status_message.fontColor = "#ffc800";
    }
    if (periodicity < 100 && numPlots > 2) {
        templateObj.$.ti_widget_label_status_message.label = "Warning: Try reducing the number of plots or reducing the frame rate for better performance";
        templateObj.$.ti_widget_label_status_message.visible = true;
        templateObj.$.ti_widget_label_status_message.fontColor = "#ffc800";

    }
    if (P.guiMonitor[subFrameNum].rangeAzimuthHeatMap == 1 || P.guiMonitor[subFrameNum].rangeDopplerHeatMap == 1) {
        if (periodicity <= 200) {
            templateObj.$.ti_widget_label_status_message.label = "Warning: Heatmap plot is selected. Lower frame rate to be less than 5 fps.";
            templateObj.$.ti_widget_label_status_message.visible = true;
            templateObj.$.ti_widget_label_status_message.fontColor = "#ffc800";
        }
    }
    if (numPlots == 3 && P.guiMonitor[subFrameNum].rangeAzimuthHeatMap == 1 && P.guiMonitor[subFrameNum].rangeDopplerHeatMap == 1) {
        templateObj.$.ti_widget_label_status_message.label = "Warning: Try reducing the number of plots for better performance";
        templateObj.$.ti_widget_label_status_message.visible = true;
        templateObj.$.ti_widget_label_status_message.fontColor = "#ffc800";
    }

};
var sendCmdAndSetupPlots = function (lines, platform, sdkVersionUint16) {
    templateObj.$.ti_widget_label_status_message.visible = false;
    templateObj.$.ti_widget_label_status_message.label = "";
    templateObj.$.ti_widget_label_status_message.fontColor = "#ff0000";

    var tempParams = validationsCfg.parseCfg(lines, platform, sdkVersionUint16);
    if (tempParams.configErrorFlag == 1) {
        return;
    }

    /*save to global params*/
    Params = tempParams;
    checkFrameRateAndPlotSelection(Params);
    setupPlots(Params);
    initParamStats(Params);
    var sendCmd = true;

    //Set SDK version and Num_Virt_Ant values to global scope 
    ConfigData = function () {
        return {
            platform: platform,
            sdkVersionUint16: sdkVersionUint16,
            Num_Virt_Ant: tempParams.channelCfg.numTxAzimAnt * tempParams.channelCfg.numRxAnt,
            cmdLines: lines
        }
    }();
    realTimeTabEnableDisable(Params);
    //plot setting control should not be enabled for advanced frame
    if(Params.dfeDataOutputMode.mode === 1)
    {
        plotSettingsEnableDisable(Params);
    }    
    // change to scene params or respect user's previous choice?
    onSummaryTab(Params.guiMonitor[Params.subFrameToPlot].statsInfo == 1 ? 'Profiling' : 'Chirp/Frame');
    cmd_sender_listener.setCfg(lines, sendCmd, true, function (error) {
        if (error) {
            templateObj.$.ti_widget_label_status_message.fontColor = "#ff0000";
            templateObj.$.ti_widget_label_status_message.label = "Error: Incorrect config reported by target. Hint: Change configuration and try again";
            updateToast('Please see errors in the Console on Configure Tab. ' + templateObj.$.ti_widget_label_status_message.label)
            templateObj.$.ti_widget_label_status_message.visible = true;

        } else {
            templateObj.$.ti_widget_button_start_stop.disabled = false;
            templateObj.$.ti_widget_button_start_stop.label = 'Sensor Stop';
            updatePlotInputGroup(true);
        }
    });
};
var isSerialPortPreset = function () {
    var prefix = location.pathname;
    if (prefix.substring(0, 4) == '/gc/') {
        var tmp = location.pathname.lastIndexOf('/index.htm');
        var start = location.pathname.lastIndexOf('/', tmp >= 0 ? tmp - 1 : undefined);
        prefix = location.pathname.substring(start + 1, tmp);
    }
    var found = false;
    var ports = ['_CFG_port__comPort', '_DATA_port__comPort'];
    if (localStorage) {
        found = true;
        for (var idx = 0; idx < 2; idx++) {
            if (!localStorage[prefix + ports[idx]]) {
                found = false;
                break;
            }
        }
    }
    return found;
};
var promptSerialPort = function () {
    gc.nav.onClick('ConfigureSerialPort');
};
var checkSerialPort = function (verbose) {
    //templateObj.$.ti_widget_statusbar.statusString3 = "";
    // note: gc.connectionManager.status can be connected, disconnected, connecting and disconnecting. Not sure whether the last 2 is for public or for gc-internal only.
    // As of today, I can get data even though the status is connecting, though I expect at that point is connected.
    if (gc.connectionManager.status != 'disconnected') {
        // It would be nice if gc shows a better status message to say which port failed to open.
        var tmp = templateObj.$.ti_widget_statusbar.statusString1.split(',');
        if (tmp.length < 2) {
            // Here we are guessing what's going on
            // gives some warning but don't bother to prompt as the guess may not be correct
            //templateObj.$.ti_widget_statusbar.statusString3 = "Please ensure Serial Ports are set correctly";
            // 2nd param 5000: 5 secs timeout; last param 100: size of toast pop-up
            templateObj.$.ti_widget_statusbar.showToastMessage('Warning:', 5000, 'Please ensure Serial Ports are set correctly', null, 100); //MMWSDK-518
        }
        return true; // assume it is good enough
    } else {
        // 2nd param 5000: 5 secs timeout; last param 100: size of toast pop-up
        templateObj.$.ti_widget_statusbar.showToastMessage('Warning:', 5000, 'Please connect serial ports before configuring', null, 100); //MMWSDK-518
    }
    if (!isSerialPortPreset()) {
        templateObj.$.ti_widget_label_status_message.label = "Please setup Serial Ports and try again";
        templateObj.$.ti_widget_label_status_message.visible = true;
        templateObj.$.ti_widget_label_status_message.fontColor = "#ff0000";

        promptSerialPort();
        return false;
    }
    return true;
};
var conditionalAutoConnect = function () {
    if (gc.connectionManager.status == 'disconnected' && isSerialPortPreset()) {
        gc.connectionManager.connect().then(function () {
            // don't think it has a good callback to tell when the 'connect process' is done.
            // if (cb) cb()
        });
    } else {
        // will like to tell caller when it is done via callback
        // if (cb) cb()
    }
};
var onLoadCfg = function () {
    templateObj.$.ti_widget_label_status_message.visible = false;
    gc.File.browseAndLoad(null, null, function (data, fileInfo, err) {
        var lines = data.replace(/\r\n/g, '\n').split('\n');
        if (!checkSerialPort()) return;
        cmd_sender_listener.askVersion(function (error, mesg) {
            var platform = mesg.match(/Platform\s*:\s*(\S*)/);
            var sdkVerUint16 = mmwInput.Input.sdkVersionUint16;
            var sdkVer = mesg.match(/mmWave SDK Version\s*:\s*(\S*)/);
            var sdkVerSplit = sdkVer[1].split(".").map(Number);
            if (sdkVerSplit.length == 4 /* major + minor + bugfix + build */) {
                sdkVerUint16 = (sdkVerSplit[0] << 8) | sdkVerSplit[1];
            }
            else {
                sdkVerUint16 = mmwInput.Input.sdkVersionUint16;
            }
            showHideDopplerSettingsOnLoad(platform[1]);
            showHideFovSettingsOnLoad(platform[1]);
            sendCmdAndSetupPlots(lines, platform && platform.length > 1 ? platform[1] : mmwInput.Input.platform, sdkVerUint16);
            realTimeDynamicControls(lines, platform && platform.length > 1 ? platform[1] : mmwInput.Input.platform, mmwInput);
            realTimeTabEnableDisable(Params);  
            //plot setting control should not be enabled for advanced frame
            if(Params.dfeDataOutputMode.mode === 1)
            {
                plotSettingsEnableDisable(Params);          
            }    
        });
    }, myFileLoadDialog);
};

/*Get the values from "config" file via 'Load config from PC' and set them to RealTime Tab Controls: cfar, clutter, peakGrouping */
var realTimeDynamicControls = function(lines, platform, mmwInput) {
    lines.forEach(function(item, index) {
        var trimmedItem = item.replace(/ {1,}/g," ");
        var items = trimmedItem.split(" ");
        if (items[0] == "cfarCfg")  {
            if (platform == "xWR14xx") {
                var linearVal = parseInt(items[items.length - 1]);
                var rangeDetectionThresholdVal = mmwInput.convertSensitivityLinearTodB(linearVal, platform, ConfigData? ConfigData.Num_Virt_Ant : mmwInput.Input.Num_Virt_Ant);
                if (rangeDetectionThresholdVal) {
                    templateObj.$.ti_widget_slider_cfar_range_threshold.value = rangeDetectionThresholdVal;
                } else {
                    errorMesg = "Range threshold value is incorrect.";
                    isError = true;
                }
            } else if (platform == "xWR16xx") {
                var linearVal = parseInt(items[items.length - 1]);
                var thresholdValue = mmwInput.convertSensitivityLinearTodB(linearVal, platform, ConfigData ? ConfigData.Num_Virt_Ant : mmwInput.Input.Num_Virt_Ant);
                if (items[2] === '0') {
                    if (thresholdValue) {
                        templateObj.$.ti_widget_slider_cfar_range_threshold.value = thresholdValue;
                    } else {
                        errorMesg = "Range threshold value is incorrect.";
                        isError = true;
                    }

                } else if (items[2] === '1') {
                    if (thresholdValue) {
                        templateObj.$.ti_widget_slider_doppler_range_threshold.value = thresholdValue;
                    } else {
                        errorMesg = "Doppler threshold value is incorrect.";
                        isError = true;
                    }
                }
            } else if ((platform == "xWR18xx")||(platform == "xWR68xx")) {
                var linearVal = parseInt(items[items.length - 2]);
                var peakVal = parseInt(items[items.length - 1]);
                var thresholdValue = mmwInput.convertSensitivityLinearTodB(linearVal, platform, ConfigData ? ConfigData.Num_Virt_Ant : mmwInput.Input.Num_Virt_Ant);
                if (items[2] === '0') {
                    if (thresholdValue) {
                        templateObj.$.ti_widget_slider_cfar_range_threshold.value = thresholdValue;
                        templateObj.$.ti_widget_checkbox_grouppeak_rangedir.checked = (peakVal == 1) ? true : false;
                    } else {
                        errorMesg = "Range threshold value is incorrect.";
                        isError = true;
                    }

                } else if (items[2] === '1') {
                    if (thresholdValue) {
                        templateObj.$.ti_widget_slider_doppler_range_threshold.value = thresholdValue;
                        templateObj.$.ti_widget_checkbox_grouppeak_dopplerdir.checked = (peakVal == 1) ? true : false;
                    } else {
                        errorMesg = "Doppler threshold value is incorrect.";
                        isError = true;
                    }
                }

            }
        }
        if (items[0] == "clutterRemoval") {
            if (items[items.length - 1] == 1) {
                templateObj.$.ti_widget_checkbox_clutter_removal.checked = true;
            } else if (items[items.length - 1] == 0) {
                templateObj.$.ti_widget_checkbox_clutter_removal.checked = false;
            }
        }
        if (items[0] == "peakGrouping") {
            
            if(platform == "xWR14xx"){
                templateObj.$.ti_widget_checkbox_grouppeak_rangedir.checked = (items[2] == 1) ? true : false;
                templateObj.$.ti_widget_checkbox_grouppeak_dopplerdir.checked = (items[3] == 1) ? true : false;
            }
             else if (platform == "xWR16xx"){
                templateObj.$.ti_widget_checkbox_grouppeak_rangedir.checked = (items[3] == 1) ? true : false;
                templateObj.$.ti_widget_checkbox_grouppeak_dopplerdir.checked = (items[4] == 1) ? true : false;
            }
        }

        // Update AoA FOV
        if (items[0] == 'aoaFovCfg') {
            var aoAFovValues = items;
            templateObj.$.ti_widget_textbox_azimuth_min.value = aoAFovValues[2];
            templateObj.$.ti_widget_textbox_azimuth_max.value = aoAFovValues[3];
            templateObj.$.ti_widget_textbox_elevation_min.value = aoAFovValues[4];
            templateObj.$.ti_widget_textbox_elevation_max.value = aoAFovValues[5];
        }

        // update Range & Doppler Fov
        if(items[0]== 'cfarFovCfg') {
            var rangeFovValues = items;
            if (rangeFovValues[2] == '0') {
                templateObj.$.ti_widget_textbox_range_fov_min.value = rangeFovValues[3];
                templateObj.$.ti_widget_textbox_range_fov_max.value = rangeFovValues[4];
            }

            if (rangeFovValues[2] == '1') {
                templateObj.$.ti_widget_textbox_doppler_fov_min.value = rangeFovValues[3];
                templateObj.$.ti_widget_textbox_doppler_fov_max.value = rangeFovValues[4];
            }

        }
    });
}
/* Hide the Real Time Tab when Advanced Frame Configuration is loaded */
var realTimeTabEnableDisable = function() {
    if(Params.dfeDataOutputMode.mode === 3){
        //select the advanced command tab.
        templateObj.$.ti_widget_tabcontainer_dynamic_tunning.selectedIndex = 1;
        //disable any colormap that might have been enabled previously
        templateObj.$.ti_widget_droplist_scatter_colormap.selectedValue = 1;
        templateObj.$.ti_widget_tab_Real_time_tunning.visible = false;
        templateObj.$.ti_widget_container_scatter_slider.visible= false;
        //disable realtime tuning tab
        templateObj.$.ti_widget_tabcontainer_dynamic_tunning.getChildTab(0).setAttribute('disabled', 'true');
        //disable plot setting tab
        templateObj.$.ti_widget_tabcontainer_dynamic_tunning.getChildTab(2).setAttribute('disabled', 'true');
    } else {
        templateObj.$.ti_widget_tab_Real_time_tunning.visible = true;
        templateObj.$.ti_widget_container_scatter_slider.visible= true;
        templateObj.$.ti_widget_tabcontainer_dynamic_tunning.selectedIndex = 0;
        templateObj.$.ti_widget_tabcontainer_dynamic_tunning.getChildTab(0).removeAttribute('disabled', 'true');
        templateObj.$.ti_widget_tabcontainer_dynamic_tunning.getChildTab(2).removeAttribute('disabled', 'true');
    }
}

/*Enable and Disable controls in Plot Setting Tab based on the configuration*/ 
var plotSettingsEnableDisable= function(){
    /* When Scatter plot is disbled either from send command or from Load config then
    Plot Tab will be disabled and Selected Tab will be "Real-Time Tunning"*/
    if (Params.guiMonitor[0].detectedObjects == 0) {
        templateObj.$.ti_widget_tabcontainer_dynamic_tunning.getChildTab(2).setAttribute('disabled', 'true');
    } 
    /*  When framePeriodicity > 250 then scatter slider is diabled; color map is enabled;
        and Selected Tab will be "Real-Time Tunning Tab" */
    else if (Params.frameCfg.framePeriodicity > 250) {
        templateObj.$.ti_widget_container_scatter_slider.visible = false;
        templateObj.$.ti_widget_container_scatterplot_colormap.visible = true;
    } 
    /*  When  Scatter plot is enabled and framePeriodicity < 250 then scatter slider,color map features are enabled 
    user could perform the actions; and Selected Tab will be "Real-Time Tunning"*/
   if (Params.guiMonitor[0].detectedObjects != 0 ) { 
        templateObj.$.ti_widget_tabcontainer_dynamic_tunning.getChildTab(2).removeAttribute('disabled', 'true');
        if (Params.frameCfg.framePeriodicity < 250){
            var frmPr = (Params.frameCfg.framePeriodicity/1000).toFixed(2);
            templateObj.$.ti_widget_container_scatter_slider.visible = true;
            templateObj.$.ti_widget_container_scatterplot_colormap.visible = true;
            templateObj.$.ti_widget_slider_scatter_plot_display_time.labels = [frmPr, 0.25];
            templateObj.$.ti_widget_slider_scatter_plot_display_time.minValue = frmPr;
            templateObj.$.ti_widget_slider_scatter_plot_display_time.value = frmPr;
        }
        else{
             templateObj.$.ti_widget_container_scatter_slider.visible = false;
            templateObj.$.ti_widget_container_scatterplot_colormap.visible = true;
        }
    }
   
    templateObj.$.ti_widget_droplist_scatter_colormap.selectedValue = 1;
/* When 3d plot is loaded colorMap dropdown:- "Elevation" will be enabled 
   and 2d plot "Elevation" value will be disabled. 
   Also, aggregation is disabled for 3D plot.*/
    if (templateObj.$.ti_widget_plot1.data[0].type == 'scatter3d') {
        templateObj.$.ti_widget_container_scatter_slider.visible = false;
        ti_widget_droplist_scatter_colormap.$.selectorList.options[3].disabled = false;
    } else {
        ti_widget_droplist_scatter_colormap.$.selectorList.options[3].disabled = true;
    }

    
}

var onStartStop = function () {
    var cmd = templateObj.$.ti_widget_button_start_stop.label;
    var next, disableInput;
    if (cmd == 'Sensor Stop') {
        cmd = 'sensorStop';
        next = 'Sensor Start';
        disableInput = false;
    } else if (cmd == 'Sensor Start') {
        cmd = 'sensorStart 0';
        next = 'Sensor Stop';
        disableInput = true;
        if (Params) setupPlots(Params);//Test whether this is ok
    }
    updatePlotInputGroup(disableInput);
    cmd_sender_listener.setCfg([cmd], true, false, function () {
        templateObj.$.ti_widget_button_start_stop.label = next;
    });
};
var checkBrowser = function () {
    var tmp = false;
    if (navigator.userAgent.indexOf('Firefox') >= 0) {
        tmp = true;
    }
    // chrome browser has chrome, safari. Safrai browser has chrome, safari.
    if (tmp) {
        updateToast('Please use Chrome browser for better performance', 100)
    }
    return tmp;
};
var updateToast = function (mesg, dur) {
    // updateToast() to hide the toast, updateToast('my mesg', 10) to show.
    // If user is on Plots tab and loadcfg has an error, it would be nice to use this toast to instruct the user.
    if (mesg && mesg.length > 0) {
        templateObj.$.ti_widget_toast_common.message = mesg;
        templateObj.$.ti_widget_toast_common.duration = dur || 15; // duraton (sec) to show message. The toast will then close if not yet. 0 means infinite.
        templateObj.$.ti_widget_toast_common.showToast();
    } else {
        templateObj.$.ti_widget_toast_common.hideToast();
    }
};
var NUM_ANGLE_BINS = 64;
var Params;
var range_depth = 10;// Required. To be configured
var range_width = 5;// Required. To be configured
var maxRangeProfileYaxis = 2e6;// Optional. To be configured
var debug_mode = 0;
var COLOR_MAP = [[0, 'rgb(0,0,128)'], [1, 'rgb(0,255,255)']];

var dspFftScalComp2 = function (fftMinSize, fftSize) {
    sLin = fftMinSize / fftSize;
    //sLog = 20*log10(sLin);
    return sLin;
}

var dspFftScalComp1 = function (fftMinSize, fftSize) {
    smin = (Math.pow((Math.ceil(Math.log2(fftMinSize) / Math.log2(4) - 1)), 2)) / (fftMinSize);
    sLin = (Math.pow((Math.ceil(Math.log2(fftSize) / Math.log2(4) - 1)), 2)) / (fftSize);
    sLin = sLin / smin;
    //sLog = 20*log10(sLin);
    return sLin;
}
/*Set isRealTime=false by default.
If there is an error while validating the 'FOV' commands in Real Time Tuning window.
then isRealTime sets to 'true' and display corresponding error messages defined in validations 
in Real time window.  */
var configError = function (errorStr, typeOfCmd, isRealTime=false) {
    console.log("ERROR: " + errorStr);
     if(isRealTime) {
              templateObj.$.ti_widget_label_realtimetuning_error_message.visible = true;
                templateObj.$.ti_widget_label_realtimetuning_error_message.fontColor = "#ff0000";
                templateObj.$.ti_widget_label_realtimetuning_error_message.label = "Error: Invalid configuration. " + errorStr;
    }
    else{
    if(!typeOfCmd){
        templateObj.$.ti_widget_label_status_message.fontColor = "#ff0000";
        templateObj.$.ti_widget_label_status_message.label = "Error: Invalid configuration. ";
        updateToast(templateObj.$.ti_widget_label_status_message.label + errorStr, 10)
        templateObj.$.ti_widget_label_status_message.visible = true;
    } else {
        templateObj.$.ti_widget_label_dynamic_status_message.fontColor = "#ff0000";
        templateObj.$.ti_widget_label_dynamic_status_message.label = "Error: Invalid configuration. " + errorStr;
        //updateToast(templateObj.$.ti_widget_label_status_message.label + errorStr, 10)
        templateObj.$.ti_widget_label_dynamic_status_message.visible = true;
    }

}
}

var profileCfgCounter = 0;
var chirpCfgCounter = 0;

/*This function returns the profile index used by the current 
subframe. This is the "index" in the profileCfg 
array created in the GUI from all the profileCfgs that the GUI parsed
and stored in the array.

-If frameCfg is used (either on AR14 or AR16) it is assumed
that only one profileCfg is used for all chirps listed in the
frameCfg command (usual assumption). User can configure more
than one profile by issuing multiple profileCfg commands, 
but all chirps listed in the frameCfg must point to the same profile.
This function will find the first chirp in the frameCfg command
and look for the chirpCfg that contains that chirp. From the 
chirpCfg it will find the profileID that needs to be used.
From profileID it will find the index in the profileCfg array.

-If advanced frame config is used, this function return 
the index where the profileCfg is for the give subframe.
(from subframe need to find chirpCfg, from chirpCfg need 
to find profileID and from profile ID we can find the index).

This function returns -1 if the profile index is not found.
*/
var getProfileIdx = function (ParamsIn, subFrameNum) {
    var firstChirp;
    if (ParamsIn.dfeDataOutputMode.mode == 1) {
        /* This is legacy frame cfg.*/
        firstChirp = ParamsIn.frameCfg.chirpStartIdx;
    }
    else if (ParamsIn.dfeDataOutputMode.mode == 3) {
        /* Get first chirp configured for this subframe*/
        firstChirp = ParamsIn.subFrameCfg[subFrameNum].chirpStartIdx;
    }

    /*find which chirp config command contains this chirp*/
    var i;
    var profileId = -1;
    for (i = 0; i < chirpCfgCounter; i++) {
        if ((firstChirp >= ParamsIn.chirpCfg[i].startIdx) &&
            (firstChirp <= ParamsIn.chirpCfg[i].endIdx)) {
            /*found chirpCfg index = i*/
            /*now get the profile ID from the chirp cfg.
              Assuming that all chirps in the frame/subframe
              point to the same profile. Therefore we can
              get the profile from the very first chirpCfg
              that is inside the range defined in the frame/subframe.*/
            profileId = ParamsIn.chirpCfg[i].profileId;
        }
    }
    if (profileId == -1) return -1;
    /*find the profile index from the profile ID*/
    for (i = 0; i < profileCfgCounter; i++) {
        if (ParamsIn.profileCfg[i].profileId == profileId) return i;
    }
    /*did not find profile*/
    return -1;
}

/*This function populates the antenna configuration in the dataPath array for
a given subFrame number.
  Returns -1 if error.
  Returns 0 if success.*/
var getAntCfg = function (ParamsIn, subFrameNum) {
    if (ParamsIn.dfeDataOutputMode.mode == 1) {
        /* This is legacy frame cfg and the
           antenna configuration can be computed as before.
           We can use the information stored in the chirpCfg[0]
           as it should not matter which chirpCfg we choose in 
           this case.*/
        if (ParamsIn.chirpCfg[0].numTxAzimAnt == 1) {
            /*Non-MIMO - this overrides the channelCfg derived values*/
            ParamsIn.dataPath[0].numTxAzimAnt = 1;
        }
        else {
            /*get configuration from channelCfg*/
            ParamsIn.dataPath[0].numTxAzimAnt = ParamsIn.channelCfg.numTxAzimAnt;
        }
        /*The other configuration comes directly from channelCfg*/
        ParamsIn.dataPath[0].numTxElevAnt = ParamsIn.channelCfg.numTxElevAnt;
        ParamsIn.dataPath[0].numRxAnt = ParamsIn.channelCfg.numRxAnt;
    }
    else if (ParamsIn.dfeDataOutputMode.mode == 3) {
        /*First need to find which chirpCfg is associated with this subframe*/
        var chirp = ParamsIn.subFrameCfg[subFrameNum].chirpStartIdx;
        /*find which chirp config command contains this chirp*/
        var i;
        var foundFlag = false;
        for (i = 0; i < chirpCfgCounter; i++) {
            if ((chirp >= ParamsIn.chirpCfg[i].startIdx) &&
                (chirp <= ParamsIn.chirpCfg[i].endIdx)) {
                /*found chirpCfg index*/
                foundFlag = true;
                break;
            }
        }
        if (foundFlag == false) return -1;

        if (ParamsIn.chirpCfg[i].numTxAzimAnt == 1) {
            /*Non-MIMO - this overrides the channelCfg derived values*/
            ParamsIn.dataPath[subFrameNum].numTxAzimAnt = 1;
        }
        else {
            /*get configuration from channelCfg*/
            ParamsIn.dataPath[subFrameNum].numTxAzimAnt = ParamsIn.channelCfg.numTxAzimAnt;
        }

        /*The other configuration comes directly from channelCfg*/
        ParamsIn.dataPath[subFrameNum].numTxElevAnt = ParamsIn.channelCfg.numTxElevAnt;
        ParamsIn.dataPath[subFrameNum].numRxAnt = ParamsIn.channelCfg.numRxAnt;
    }
    else {
        return -1;
    }
    return 0;
}

/*This function checks if a valid subframe index is received.
  Returns -1 if subframe index is invalid.
  Returns 0 if subframe index is valid.
*/
var checkSubFrameIdx = function (ParamsIn, subFrameNum, platform, sdkVersionUint16, command, dynamicFlg) {

    if (platform == mmwInput.Platform.xWR14xx) 
    {
        /* No check done for AR14 as no subframe idx is received.*/
        return 0;
    }

    if (ParamsIn.dfeDataOutputMode.mode == 1) {
        /* legacy frame config*/
        if (subFrameNum != subFrameNumInvalid) {
            configError(command + " SubFrameIdx must be set to -1 (i.e. N/A).", dynamicFlg);
            return -1;
        }
        return 0;
    }
    else if (ParamsIn.dfeDataOutputMode.mode == 3) {
        if ((subFrameNum >= maxNumSubframes) || (subFrameNum < -1)) {
            configError(command + " SubFrameIdx is invalid.", dynamicFlg);
            return -1;
        }
        return 0;
    }
    else {
        configError("Make sure dfeDataOutputMode has been configured before " + command + ". dfeDataOutputMode must be set to either 1 or 3.", dynamicFlg);
        return -1;
    }
}

var byte_mult = [1, 256, Math.pow(2, 16), Math.pow(2, 24)];

var isMagic = function (bytevec, byteVecIdx) {
    if (bytevec.length >= byteVecIdx + 8) {
        return (
            bytevec[byteVecIdx + 0] == 2 && bytevec[byteVecIdx + 1] == 1 &&
            bytevec[byteVecIdx + 2] == 4 && bytevec[byteVecIdx + 3] == 3 &&
            bytevec[byteVecIdx + 4] == 6 && bytevec[byteVecIdx + 5] == 5 &&
            bytevec[byteVecIdx + 6] == 8 && bytevec[byteVecIdx + 7] == 7
        );
    }
    return false;
};

var totalFrameSize = function (bytevec, byteVecIdx) {
    var totalPacketLen = math.sum(math.dotMultiply(bytevec.slice(byteVecIdx, byteVecIdx + 4), byte_mult));
    return totalPacketLen;
}

var searchMagic = function (bytevec, byteVecIdx) {
    var len = bytevec.length;
    var exp = [2, 1, 4, 3, 6, 5, 8, 7];
    var expidx = 0;
    for (var idx = byteVecIdx; idx < len; idx++) {
        if (bytevec[idx] == exp[expidx]) {
            if (expidx == exp.length - 1) {
                var findIdx = idx - exp.length + 1;
                return findIdx;
            } else {
                expidx++;
            }
        } else {
            expidx = 0;
        }
    }
    return -1;
}

var stats = function () {
    this.accumTotal = 0;
    this.accumTotalCnt = 0;
    this.avg = 0;
    this.max = 0;
    this.min = 99999999;
    this.maxExceededCnt = 0;
    this.maxExceededFrame = 0;
    return this;
};

var plotStats = function () {
    this.scatterStats = new stats();
    this.rangeStats = new stats();
    this.noiseStats = new stats();
    this.azimuthStats = new stats();
    this.dopplerStats = new stats();
    this.cpuloadStats = new stats();
    this.processFrameStats = new stats();
    this.dataStats = new stats();
    this.sideInfoStats = new stats();
    return this;
};

var initParamStats = function (Params) {
    Params.plot = new plotStats();
    Params.plot.droppedFrames = 0;
    Params.plot.lastPlotServiced = 0;
    Params.plot.dataFrames = 0;
};
var getTimeDiff = function (start_timestamp) {
    if (gDebugStats == 1) {
        return (new Date().getTime() - start_timestamp);
    }
    else {
        return 0;
    }
};
var gatherParamStats = function (paramStats, value) {
    if (gDebugStats == 1) {
        paramStats.accumTotal += value;
        paramStats.accumTotalCnt++;
        paramStats.avg = paramStats.accumTotal / paramStats.accumTotalCnt;
        if ((paramStats.max < value) && (paramStats.accumTotalCnt > 1)) {
            paramStats.max = value;
            paramStats.maxExceededCnt++;
            paramStats.maxExceededFrame = paramStats.accumTotalCnt; //Params.frameNumber;
        }
        if (paramStats.min > value) {
            paramStats.min = value;
        }
    }
}

var getFramePeriodicty = function (subframeNum) {
    var periodicity = 0;
    if (Params.dfeDataOutputMode.mode == 1) {
        periodicity = Params.frameCfg.framePeriodicity;
    }
    else if (Params.dfeDataOutputMode.mode == 3) {
        periodicity = Params.subFrameCfg[subframeNum].subFramePeriodicity;
    }
    return periodicity;
};


var TLV_type = {
    MMWDEMO_OUTPUT_MSG_DETECTED_POINTS: 1,
    MMWDEMO_OUTPUT_MSG_RANGE_PROFILE: 2,
    MMWDEMO_OUTPUT_MSG_NOISE_PROFILE: 3,
    MMWDEMO_OUTPUT_MSG_AZIMUT_STATIC_HEAT_MAP: 4,
    MMWDEMO_OUTPUT_MSG_RANGE_DOPPLER_HEAT_MAP: 5,
    MMWDEMO_OUTPUT_MSG_STATS: 6,
    MMWDEMO_OUTPUT_MSG_DETECTED_POINTS_SIDE_INFO: 7,//This is present only on SDK 3.0 forwards
    MMWDEMO_OUTPUT_MSG_MAX: 8
};
// caution 0-based indexing; ending index not included unless otherwise specified
var process1 = function (bytevec) {
    //check sanity of bytevec
    if ((bytevec.length >= 8 + 4 + 4) && isMagic(bytevec, 0)) {
        /* proceed */
    }
    else {
        return;
    }

    // Header
    var byteVecIdx = 8; // magic word (4 unit16)
    var numDetectedObj = 0;
    // Version, uint32: MajorNum * 2^24 + MinorNum * 2^16 + BugfixNum * 2^8 + BuildNum
    Params.tlv_version = bytevec.slice(byteVecIdx, byteVecIdx + 4);
    Params.tlv_version_uint16 = Params.tlv_version[2] + (Params.tlv_version[3] << 8);
    byteVecIdx += 4;

    // Total packet length including header in Bytes, uint32
    var totalPacketLen = math.sum(math.dotMultiply(bytevec.slice(byteVecIdx, byteVecIdx + 4), byte_mult));
    byteVecIdx += 4;
    if (bytevec.length >= totalPacketLen) {
        /* proceed */
    }
    else {
        return;
    }
    var start_ts = getTimeDiff(0);


    //platform type, uint32: 0xA1643 or 0xA1443 
    Params.tlv_platform = math.sum(math.dotMultiply(bytevec.slice(byteVecIdx, byteVecIdx + 4), byte_mult));
    byteVecIdx += 4;

    // Frame number, uint32
    Params.frameNumber = math.sum(math.dotMultiply(bytevec.slice(byteVecIdx, byteVecIdx + 4), byte_mult));
    byteVecIdx += 4;

    // Time in CPU cycles when the message was created. For AR16xx: DSP CPU cycles, for AR14xx: R4F CPU cycles, uint32
    var timeCpuCycles = math.sum(math.dotMultiply(bytevec.slice(byteVecIdx, byteVecIdx + 4), byte_mult));
    byteVecIdx += 4;

    // Number of detected objects, uint32
    numDetectedObj = math.sum(math.dotMultiply(bytevec.slice(byteVecIdx, byteVecIdx + 4), byte_mult));
    byteVecIdx += 4;

    // Number of TLVs, uint32
    var numTLVs = math.sum(math.dotMultiply(bytevec.slice(byteVecIdx, byteVecIdx + 4), byte_mult));
    byteVecIdx += 4;

    // subFrame number, uint32
    if ((Params.platform == mmwInput.Platform.xWR16xx) ||
        (Params.platform == mmwInput.Platform.xWR18xx) ||
        (Params.platform == mmwInput.Platform.xWR68xx))
        {
        Params.currentSubFrameNumber = math.sum(math.dotMultiply(bytevec.slice(byteVecIdx, byteVecIdx + 4), byte_mult));
        byteVecIdx += 4;
        if (Params.dfeDataOutputMode.mode != 3) {
            /*make sure this is set to zero when legacy frame is used*/
            Params.currentSubFrameNumber = 0;
        }
    }
    else {
        Params.currentSubFrameNumber = 0;
    }
    Params.numDetectedObj[Params.currentSubFrameNumber] = numDetectedObj;

   //Cache the latest frameNumber and deletes the old frameNumber
   var detObjRes = {};
   var sideInfo  = {};
   
   Params.scatter_data.frameNumList.shift();
   Params.scatter_data.frameNumList.push(Params.frameNumber);
   
   /* Some of the TLVs must be processed in a specific order:
   1. MMWDEMO_OUTPUT_MSG_RANGE_PROFILE can only be processed after MMWDEMO_OUTPUT_MSG_DETECTED_POINTS
      because detObjRes is an input to MMWDEMO_OUTPUT_MSG_RANGE_PROFILE
   2. MMWDEMO_OUTPUT_MSG_DETECTED_POINTS can only be processed after MMWDEMO_OUTPUT_MSG_DETECTED_POINTS_SIDE_INFO
      because MMWDEMO_OUTPUT_MSG_DETECTED_POINTS needs peakVal which is computed as part of the side info TLV.
      This item is valid for SDK releases 3.0 and beyond, where side info is available.
   */   
   //Initialize bytevec index (location in bytevec) for the corresponding TLVs to "not received" (-1)
   Params.detectedPoints_byteVecIdx = -1;
   Params.rangeProfile_byteVecIdx   = -1;
   Params.sideInfo_byteVecIdx       = -1;

    // Start of TLVs
    //console.log("got number subf=%d and numTLVs=%d tlvtype=%d",Params.currentSubFrameNumber,numTLVs);
    var start_tlv_ticks;
    for (var tlvidx = 0; tlvidx < numTLVs; tlvidx++) {
        var tlvtype = math.sum(math.dotMultiply(bytevec.slice(byteVecIdx, byteVecIdx + 4), byte_mult));
        byteVecIdx += 4;
        var tlvlength = math.sum(math.dotMultiply(bytevec.slice(byteVecIdx, byteVecIdx + 4), byte_mult));
        byteVecIdx += 4;
        start_tlv_ticks = getTimeDiff(0);
        // tlv payload
        if (tlvtype == TLV_type.MMWDEMO_OUTPUT_MSG_DETECTED_POINTS) {
            // will not get this type if numDetectedObj == 0 even though gui monitor selects this type
            Params.detectedPoints_byteVecIdx = byteVecIdx;
        } else if (tlvtype == TLV_type.MMWDEMO_OUTPUT_MSG_RANGE_PROFILE) {
            Params.rangeProfile_byteVecIdx = byteVecIdx;
        } else if (tlvtype == TLV_type.MMWDEMO_OUTPUT_MSG_NOISE_PROFILE) {
            processRangeNoiseProfile(bytevec, byteVecIdx, Params, false);
            gatherParamStats(Params.plot.noiseStats, getTimeDiff(start_tlv_ticks));
        } else if (tlvtype == TLV_type.MMWDEMO_OUTPUT_MSG_AZIMUT_STATIC_HEAT_MAP) {
            processAzimuthHeatMap(bytevec, byteVecIdx, Params);
            gatherParamStats(Params.plot.azimuthStats, getTimeDiff(start_tlv_ticks));
        } else if (tlvtype == TLV_type.MMWDEMO_OUTPUT_MSG_RANGE_DOPPLER_HEAT_MAP) {
            processRangeDopplerHeatMap(bytevec, byteVecIdx, Params);
            gatherParamStats(Params.plot.dopplerStats, getTimeDiff(start_tlv_ticks));
        } else if (tlvtype == TLV_type.MMWDEMO_OUTPUT_MSG_STATS) {
            processStatistics(bytevec, byteVecIdx, Params);
            gatherParamStats(Params.plot.cpuloadStats, getTimeDiff(start_tlv_ticks));
        } else if (tlvtype == TLV_type.MMWDEMO_OUTPUT_MSG_DETECTED_POINTS_SIDE_INFO) {
            Params.sideInfo_byteVecIdx = byteVecIdx;
        }

        byteVecIdx += tlvlength;
    }
    
    /* Now process the (remaining) received TLVs in the required order:
       Side info -> detected points -> range profile */
    if(Params.sideInfo_byteVecIdx > -1)
    {
        start_tlv_ticks = getTimeDiff(0);
        sideInfo = processSideInfo(bytevec, Params.sideInfo_byteVecIdx, Params);
        gatherParamStats(Params.plot.sideInfoStats, getTimeDiff(start_tlv_ticks));
    }        

    Params.sideInfo = sideInfo;

    /*If no side info is received (for SDK 3.0 onwards) and the scatter plot is 
      selected to be plotted with colormap option = "intensity", then all detected
      points will be plotted with a fixed color as there is no intensity information*/

    if(Params.detectedPoints_byteVecIdx > -1)
    {
        start_tlv_ticks = getTimeDiff(0);
        detObjRes = processDetectedPoints(bytevec, Params.detectedPoints_byteVecIdx, Params);
        gatherParamStats(Params.plot.scatterStats, getTimeDiff(start_tlv_ticks));
    }        

    if(Params.rangeProfile_byteVecIdx > -1)
    {
        start_tlv_ticks = getTimeDiff(0);
        processRangeNoiseProfile(bytevec, Params.rangeProfile_byteVecIdx, Params, true, detObjRes);
        gatherParamStats(Params.plot.rangeStats, getTimeDiff(start_tlv_ticks));
    }        

            
    /*Make sure that scatter plot is updated when advanced frame config
      is used even when there is no data for this subframe.
      Make sure that scatter plot is updated when legacy frame is used and there is
      no detected object in this frame. Otherwise, if there was detected objects in the previous
      frame it would still show up in the scatter plot for this frame if the plot is not refreshed.*/
    if (((Params.dfeDataOutputMode.mode == 3) && ((Params.numDetectedObj[Params.currentSubFrameNumber] == 0)||(Params.guiMonitor[Params.currentSubFrameNumber].detectedObjects == 0)))||
        ((Params.dfeDataOutputMode.mode == 1) && (Params.numDetectedObj[Params.currentSubFrameNumber] == 0)))
    {
        var start_tlv_ticks = getTimeDiff(0);
        Params.subFrameNoDataFlag = 1;
        processDetectedPoints(undefined, undefined, Params);
        gatherParamStats(Params.plot.scatterStats, getTimeDiff(start_tlv_ticks));
    }

    //console.log('Process time ' + (new Date().getTime() - start_ts));
    gatherParamStats(Params.plot.processFrameStats, getTimeDiff(start_ts));

    var curPlotServiced = Params.frameNumber;
    if (Params.dfeDataOutputMode.mode == 3) {
        curPlotServiced = Params.frameNumber * Params.advFrameCfg.numOfSubFrames + Params.currentSubFrameNumber;
    }
    if (Params.plot.lastPlotServiced == 0) {
        Params.plot.lastPlotServiced = (curPlotServiced - 1);
    }
    Params.plot.droppedFrames += curPlotServiced - (Params.plot.lastPlotServiced + 1);
    Params.plot.lastPlotServiced = curPlotServiced;

    if (Params.plot.processFrameStats.accumTotalCnt > 100) {
        var periodicity = getFramePeriodicty(Params.currentSubFrameNumber);
        if (Params.plot.processFrameStats.avg > (periodicity)) {
            updateToast('Performance Degradation seen: Reduce number of plots or decrease frame rate');
        }
    }
};

var xFrameCoord = [];
var yFrameCoord = [];
var zFrameCoord = [];
var frameRange = [];
var frameDoppler = [];
var lastFramePlotted = 0;
var lastFrameSaved = 0;

var resetScatterPlotArrays = function () {
    xFrameCoord = [];
    yFrameCoord = [];
    frameRange = [];
    frameDoppler = [];
}

/*This function plots the scattered plot and range-doppler plot.
Legacy frame:
It will plot scattered plot if guiMonitor.detectedObjects is enabled.
If range doppler heat map is not enabled it will plot the range-dopler plot.

Advanced frame:
It will plot scattered plot always.
If range doppler heat map is not enabled for the one subframe that has selected the extra plots
it will plot the range-dopler plot.
*/
var plotScatterpoints = function (x_coord, y_coord, z_coord, range, doppler, plotEmpty, frameToPlot, peakValLog) {
    var plot_elapsed_time = {}; // for profile this code only
    var start_time = new Date().getTime();
    if ((plotEmpty) || (x_coord.length > 0)) 
    {
    
        if (Params.dfeDataOutputMode.mode == 3)
        {
            /*This is advanced frame and scatter plot aggregation is not implemented
              for advanced frame. In this case, we aggregate only the subframes in 
              the frame and plot it. This subframe aggregation is coming as x_coord, y_coord
              inputs to this function*/
            templateObj.$.ti_widget_plot1.data[0].x = x_coord;
            templateObj.$.ti_widget_plot1.data[0].y = y_coord;
            templateObj.$.ti_widget_plot1.data[0].z = z_coord;
        }
        else
        {
            /* This is legacy frame and we plot the data accumulated in Params.scatter_data.xyz_coord*/
            templateObj.$.ti_widget_plot1.data[0].x = Params.scatter_data.x_coord;
            templateObj.$.ti_widget_plot1.data[0].y = Params.scatter_data.y_coord;
            templateObj.$.ti_widget_plot1.data[0].z = Params.scatter_data.z_coord;
        }    

        /*Colormap OFF*/
        if (ti_widget_droplist_scatter_colormap.selectedValue == 1)
        {
            if (Params.dataPath[Params.subFrameToPlot].numTxElevAnt == 1) {
                templateObj.$.ti_widget_plot1.data[0].marker.color = 'rgb(28,153,196)';
            }
            else
            {
                templateObj.$.ti_widget_plot1.data[0].marker.color = 'rgb(0,255,0)';
            }    
        }

        /*Colormap INTENSITY*/
        if (ti_widget_droplist_scatter_colormap.selectedValue == 2) {

            templateObj.$.ti_widget_plot1.data[0].marker.color = peakValLog;
            templateObj.$.ti_widget_plot1.data[0].marker.colorscale = 'Jet';
        }
        
        /*Colormap VELOCITY*/
        if (ti_widget_droplist_scatter_colormap.selectedValue == 3) {

            templateObj.$.ti_widget_plot1.data[0].marker.color = doppler;
            templateObj.$.ti_widget_plot1.data[0].marker.colorscale = 'Jet';
        }        

        /*Colormap ELEVATION*/
        if (ti_widget_droplist_scatter_colormap.selectedValue == 4) {
            templateObj.$.ti_widget_plot1.data[0].marker.color = range;
            templateObj.$.ti_widget_plot1.data[0].marker.colorscale = 'Jet';
        }
        
        templateObj.$.ti_widget_plot1.redrawdata();
        colorMap(ti_widget_droplist_scatter_colormap.selectedValue);
    }
    
    plot_elapsed_time.scatterPlot = new Date().getTime() - start_time;
    start_time = new Date().getTime();
    if ((Params.guiMonitor[Params.subFrameToPlot].rangeDopplerHeatMap != 1) && ((plotEmpty) || (range.length > 0))) {
        /*Legacy frame config*/
        templateObj.$.ti_widget_plot3.data[0].x = range;
        templateObj.$.ti_widget_plot3.data[0].y = doppler;
        templateObj.$.ti_widget_plot3.redrawdata();
    }
    plot_elapsed_time.rangeDopplerPlot = new Date().getTime() - start_time;
    lastFramePlotted = frameToPlot;
    resetScatterPlotArrays();
    return plot_elapsed_time;
}


var getXYZ_type1 = function (x, Params, xyzQFormat)
 {
    var rangeIdx, dopplerIdx;
    var subFrameNum = Params.currentSubFrameNumber;
    /* list of detected objects, each is:
    for platform = 14xx, 16xx
    typedef volatile struct MmwDemo_detectedObj_t {
        uint16_t   rangeIdx;     Range index
        uint16_t   dopplerIdx;   Dopler index
        uint16_t  peakVal;       Peak value
        int16_t  x;              x - coordinate in meters. Q format depends on the range resolution
        int16_t  y;              y - coordinate in meters. Q format depends on the range resolution
        int16_t  z;              z - coordinate in meters. Q format depends on the range resolution
    }*/

    // convert range index to range (in meters)
    rangeIdx = math.add(x[0], math.multiply(x[1], 256));
    var range = math.map(rangeIdx, function (value) {
        return value * Params.dataPath[subFrameNum].rangeIdxToMeters;
    });
    //circshift the doppler fft bins
    dopplerIdx = math.add(x[2], math.multiply(x[3], 256));
    if (Params.tlv_version_uint16 > 0x0100) {
        math.forEach(dopplerIdx, function (value, idx, ary) {
            if (value > 32767) {
                ary[idx] = ary[idx] - 65536;
            }
        });
    } else {
        math.forEach(dopplerIdx, function (value, idx, ary) {
            if (value > Params.dataPath[subFrameNum].numDopplerBins / 2 - 1) {
                ary[idx] = ary[idx] - Params.dataPath[subFrameNum].numDopplerBins;
            }
        });

    }
    // convert doppler index to doppler (meters/sec)
    var doppler = math.map(dopplerIdx, function (value, idx, ary) {
        return value * Params.dataPath[subFrameNum].dopplerResolutionMps;
    });
    // peak value
    var peakVal = math.add(x[4], math.multiply(x[5], 256));
    var peakValLog = math.map(peakVal, function (value) {
        return Math.round(10 * math.log10(1 + value));
    });
    // x_coord, y_coord, z_coord
    var x_coord = math.add(x[6], math.multiply(x[7], 256));
    var y_coord = math.add(x[8], math.multiply(x[9], 256));
    var z_coord = math.add(x[10], math.multiply(x[11], 256));
    var xyz = [x_coord, y_coord, z_coord];
    for (var xyzidx = 0; xyzidx < xyz.length; xyzidx++) {
        math.forEach(xyz[xyzidx], function (value, idx, ary) {
            if (value > 32767) { value = value - 65536; }
            ary[idx] = value / xyzQFormat;
        });
    }

    return { rangeIdx: rangeIdx, dopplerIdx: dopplerIdx, x_coord: x_coord, y_coord: y_coord, z_coord: z_coord, doppler: doppler , peakValLog: peakValLog}
}

/*This is a tentative of an optimized version of getFloat(), in case getFloat() takes too many cycles. 
  This needs to be verified for correctness and code needs to be changed as output is different from getFloat().
  It also needs to be benchmarked against getFloat().
  It returns XYZD instead of just one float number.*/
var getXYZDFloat = function (vec, vecIdx, numDetecObj)
 {
    var x_coord = [];
    var y_coord = [];
    var z_coord = [];
    var doppler = [];
    var i, startIdx;
    var data =  vec.slice(vecIdx, vecIdx + 16*numDetecObj);
    var buf = new ArrayBuffer(16*numDetecObj);
    var view = new DataView(buf);

    data.forEach(function (b, i) 
    {
        view.setUint8(i, b);
    });

    for(i = 0; i < numDetecObj; i++) 
    {
        x_coord[i] = view.getFloat32(0  + 16*i, true);
        y_coord[i] = view.getFloat32(4  + 16*i, true);
        z_coord[i] = view.getFloat32(8  + 16*i, true);
        doppler[i] = view.getFloat32(12 + 16*i, true);
    }

    return { x_coord: x_coord, y_coord: y_coord, z_coord: z_coord, doppler: doppler}
}

/* Usage of getFloat32:

Syntax
dataview.getFloat32(byteOffset [, littleEndian])
byteOffset - The offset, in byte, from the start of the view where to read the data.
littleEndian - Optional Indicates whether the 32-bit float is stored in little- or big-endian format. 
If false or undefined, a big-endian value is read.

We need to use littleEndian as byte array is coming as littleEndian.
*/


//Converts 4 bytes into float
var getFloat = function (x1, x2, x3, x4)
 {
    var data =  [x1, x2, x3, x4];
    var buf = new ArrayBuffer(4);
    var view = new DataView(buf);

    data.forEach(function (b, i) {
        view.setUint8(i, b);
    });

    var num = view.getFloat32(0, true);

    //console.log(num);

    return num;
}

var getXYZ_type2 = function (vec, vecIdx, Params, numDetecObj, sizeObj) 
{
    var x_coord = [];
    var y_coord = [];
    var z_coord = [];
    var doppler = [];
    var i, startIdx;
    var subFrameNum = Params.currentSubFrameNumber;

    /* list of detected objs
    for platform = 68xx
    typedef struct DPIF_PointCloudCartesian_t
    {
        x - coordinate in meters
        float  x;
        y - coordinate in meters
        float  y;
        z - coordinate in meters
        float  z;        
        Doppler in m/s 
        float    doppler;
    }DPIF_PointCloudCartesian;
    */
    for (i = 0; i < numDetecObj; i++)  
    {
        /*start index in bytevec for this detected obj*/
        startIdx = vecIdx + i*sizeObj;

        x_coord[i] = getFloat(vec[startIdx + 0],  vec[startIdx + 1],  vec[startIdx + 2],  vec[startIdx + 3]);
        y_coord[i] = getFloat(vec[startIdx + 4],  vec[startIdx + 5],  vec[startIdx + 6],  vec[startIdx + 7]);
        z_coord[i] = getFloat(vec[startIdx + 8],  vec[startIdx + 9],  vec[startIdx + 10], vec[startIdx + 11]);
        doppler[i] = getFloat(vec[startIdx + 12], vec[startIdx + 13], vec[startIdx + 14], vec[startIdx + 15]);
    }

    var range;
    range = math.sqrt(math.add(math.dotMultiply(z_coord, z_coord), math.add(math.dotMultiply(x_coord, x_coord), math.dotMultiply(y_coord, y_coord))));

    var rangeIdx = math.map(range, function (value) {
        return Math.round(value / Params.dataPath[subFrameNum].rangeIdxToMeters);
    });

    var dopplerIdx = math.map(doppler, function (value) {
        return Math.round(value / Params.dataPath[subFrameNum].dopplerResolutionMps);
    });

    return { rangeIdx: rangeIdx, dopplerIdx: dopplerIdx, x_coord: x_coord, y_coord: y_coord, z_coord: z_coord, doppler: doppler}

}

function colorMap(selectedValue) {
    if(Params.guiMonitor[0].rangeDopplerHeatMap === 1) {
        templateObj.$.ti_widget_image_cb.visible = true;
        templateObj.$.ti_widget_label_cbmin.visible = true;
        templateObj.$.ti_widget_label_cbmax.visible = true;
    } else {
        if (Params.guiMonitor[0].detectedObjects == 1 && selectedValue !==1) {
            templateObj.$.ti_widget_image_cb.visible = true;
            templateObj.$.ti_widget_label_cbmin.visible = true;
            templateObj.$.ti_widget_label_cbmax.visible = true;
        } 
        else {
            templateObj.$.ti_widget_image_cb.visible = false;
            templateObj.$.ti_widget_label_cbmin.visible = false;
            templateObj.$.ti_widget_label_cbmax.visible = false;
        }
    }
};

var processDetectedPoints = function (bytevec, byteVecIdx, Params) {
    var elapsed_time = {}; // for profile this code only
    var rangeIdx, dopplerIdx, numDetectedObj = 0, xyzQFormat;
    var subFrameNum = Params.currentSubFrameNumber;
    var dummyArr = [];
    var proc_start_time = new Date().getTime();
    var detectedObjFormat;
    var x_coord=[];
    var y_coord=[];
    var z_coord=[];
    var doppler=[];
    var xyzOut = {};
    var peakValLog;
    var num_elem_to_remove;

    /* detected object format varies depending on the platform*/
    if ((Params.platform == mmwInput.Platform.xWR14xx) ||
        (Params.platform == mmwInput.Platform.xWR16xx))
    {
        /*Format as described in MmwDemo_detectedObj_t*/
        detectedObjFormat = 1;
    }
    else if ((Params.platform == mmwInput.Platform.xWR18xx)||
             (Params.platform == mmwInput.Platform.xWR68xx))   
    {
        /*Format as described in DPIF_PointCloudCartesian_t*/
        detectedObjFormat = 2;
    }

    if (Params.detectedObjectsToPlot == 1) {

        //console.log("subf=%d frame=%d lastPLotted=%d ",subFrameNum,Params.frameNumber,lastFramePlotted);

        /*Check if we need to redraw the plot now because we missed
        some subframe (either because it was dropped in the socket
        or because there was nothing detected in the subframe.
        Valid only for advanced frame config.*/
        if (Params.dfeDataOutputMode.mode == 3) {
            if ((Params.frameNumber > lastFramePlotted + 1) && (lastFrameSaved < Params.frameNumber)) {
                plotScatterpoints(xFrameCoord, yFrameCoord, dummyArr, frameRange, frameDoppler, 0, lastFrameSaved);
            }
        }

        if (bytevec) 
        {
            if (detectedObjFormat == 1) 
            {
                // MmwDemo_output_message_dataObjDescr
                //  Number of detected objects, uint16
                numDetectedObj = math.sum(math.dotMultiply(bytevec.slice(byteVecIdx, byteVecIdx + 2), [1, 256]));
                byteVecIdx += 2;
            
                //  Q format of detected objects x/y/z coordinates, uint16
                xyzQFormat = Math.pow(2, math.sum(math.dotMultiply(bytevec.slice(byteVecIdx, byteVecIdx + 2), [1, 256])));
                byteVecIdx += 2;
            }
            else
            {
                numDetectedObj = Params.numDetectedObj[Params.currentSubFrameNumber];
            }
        }
        
        if (numDetectedObj > 0) 
        {
            var sizeofObj;
            
            if (detectedObjFormat == 1) 
            {
                // size of MmwDemo_detectedObj_t in bytes
                sizeofObj = 12;
                var x = bytevec.slice(byteVecIdx, byteVecIdx + sizeofObj * numDetectedObj);
                x = MyUtil.reshape(x, sizeofObj, numDetectedObj);
                
                xyzOut = getXYZ_type1(x, Params, xyzQFormat);
                
                //peakval is part of MmwDemo_detectedObj_t
                peakValLog = xyzOut.peakValLog;
            }
            else if (detectedObjFormat == 2)
            {
                // size of DPIF_PointCloudCartesian in bytes
                sizeofObj = 16;
                xyzOut = getXYZ_type2(bytevec, byteVecIdx, Params, numDetectedObj, sizeofObj);
                
                /*peakval is not part of the point cloud. It needs to be computed from the side info.
                  If sideinfo is empty, peakvalLog is empty and all objects in scatter plot will be mapped
                  to same color*/
                if(Params.sideInfo_byteVecIdx > -1)
                {
                    peakValLog = math.add(Params.sideInfo.snrDB, Params.sideInfo.noiseDB);
                }    
                else
                {
                    /*Side info TLV was not received*/
                    peakValLog = {};
                }                
            }

            rangeIdx   = xyzOut.rangeIdx;
            dopplerIdx = xyzOut.dopplerIdx;
            x_coord    = xyzOut.x_coord;
            y_coord    = xyzOut.y_coord;
            z_coord    = xyzOut.z_coord;
            doppler    = xyzOut.doppler;
            
           
            //Gets the point which needs to be deleted
            num_elem_to_remove = Params.scatter_data.det_obj_list.shift();
            Params.scatter_data.det_obj_list.push(numDetectedObj);
            
            /*Update array with new detected points
              (Always concatenate new points at the end of the array)*/
            Params.scatter_data.x_coord = Params.scatter_data.x_coord.concat(x_coord);
            Params.scatter_data.y_coord = Params.scatter_data.y_coord.concat(y_coord);
            Params.scatter_data.z_coord = Params.scatter_data.z_coord.concat(z_coord);
            
            /*Need to remove elements?
              If YES, elements are always removed from the begining of the array.*/ 
            if(num_elem_to_remove > 0)
            {
                //splice() returns the removed elements, so can not assign it to the array
                Params.scatter_data.x_coord.splice(0,num_elem_to_remove);
                Params.scatter_data.y_coord.splice(0,num_elem_to_remove);
                Params.scatter_data.z_coord.splice(0,num_elem_to_remove);
            }
            
            //console.log("num_elem_to_remove " + num_elem_to_remove + " numDetectedObj " + numDetectedObj);            
            
            range = math.sqrt(math.add(math.dotMultiply(z_coord, z_coord), math.add(math.dotMultiply(x_coord, x_coord), math.dotMultiply(y_coord, y_coord))));
            if (Params.dfeDataOutputMode.mode == 3) 
            {
                lastFrameSaved = Params.frameNumber;
                /*This is advanced frame config. Need to plot objects
                detected in all subframes*/
                if (Params.currentSubFrameNumber == 0) {
                    /*start list of objects with data from subframe zero*/
                    xFrameCoord = x_coord;
                    yFrameCoord = y_coord;
                    zFrameCoord = z_coord;
                    frameRange = range;
                    frameDoppler = doppler;
                } 
                else {
                    /*append list of objects with data from subframe N=1,2,3*/
                    xFrameCoord = xFrameCoord.concat(x_coord);
                    yFrameCoord = yFrameCoord.concat(y_coord);
                    zFrameCoord = zFrameCoord.concat(z_coord);
                    frameRange = frameRange.concat(range);
                    frameDoppler = frameDoppler.concat(doppler)
                }
                /*redraw only in the last subframe*/
                /*cant redraw only in last subframe because maybe there is no data
                  for the last subframe and in that case this function is not even
                  called and the previous subframes wont be plotted. Need to redraw
                  in every subframe. Can not redraw in every subframe either because
                  subframes 1,2,3 will be blinking as they will have value zero until
                  it gets to that subframe.*/
                if ((Params.currentSubFrameNumber == Params.advFrameCfg.numOfSubFrames - 1)) {
                    elapsed_time = plotScatterpoints(xFrameCoord, yFrameCoord, dummyArr, frameRange, frameDoppler, 0, Params.frameNumber);
                }
            } 
            else 
            {
                elapsed_time = plotScatterpoints(x_coord, y_coord, z_coord, range, doppler, 1, Params.frameNumber, peakValLog);
            }
        } 
        else 
        {
            //numDetectedObj = 0, need to update the aggregation list by removing one frame worth of data
            num_elem_to_remove = Params.scatter_data.det_obj_list.shift();
            Params.scatter_data.det_obj_list.push(numDetectedObj);
            
            /*Need to remove elements?
              If so, elements are removed from the begining of the array.*/ 
            if(num_elem_to_remove > 0)
            {
                Params.scatter_data.x_coord.splice(0,num_elem_to_remove);
                Params.scatter_data.y_coord.splice(0,num_elem_to_remove);
                Params.scatter_data.z_coord.splice(0,num_elem_to_remove);
            }

            if (Params.dfeDataOutputMode.mode != 3) 
            {
                elapsed_time = plotScatterpoints(dummyArr, dummyArr, dummyArr, dummyArr, dummyArr, 1, Params.frameNumber, peakValLog);
            } 
            else 
            {
                if (Params.currentSubFrameNumber == Params.advFrameCfg.numOfSubFrames - 1) {
                    elapsed_time = plotScatterpoints(xFrameCoord, yFrameCoord, dummyArr, frameRange, frameDoppler, 0, Params.frameNumber, peakValLog);
                }
            }
        }
    } // end if (Params.guiMonitor.detectedObjects == 1)
    elapsed_time.total_det_obj_process = new Date().getTime() - proc_start_time;
    return { rangeIdx: rangeIdx, dopplerIdx: dopplerIdx, numDetectedObj: numDetectedObj }
};

/* 
- For xWR14xx and xWR16xx legacy frame are always located in index zero as there is no concept of subframe.
  In this case, this function will return index ZERO.
- In the case of advanced frame :
  All plots (with exception of scatter plot and doppler-range plot) support only one subframe.
  If multiple subframes select plots other than the scatter/doppler-range, the GUI will plot only
  the first subframe that selected the plots.
  If any guimonitor command has a -1 selection for subframe (meaning apply config to all subframes)
  then GUI will plot subframe zero.
*/
var subframeNumberToPlot = function (Params) {
    var i;

    /*Is this advanced frame config mode?*/
    if (((Params.platform == mmwInput.Platform.xWR16xx) ||
        (Params.platform == mmwInput.Platform.xWR18xx) ||
        (Params.platform == mmwInput.Platform.xWR68xx)) && (Params.dfeDataOutputMode.mode == 3)) {
        /* need to find the first GUI monitor command that has a valid
           plot enabled and this will be the subframe that will be plotted*/
        for (i = 0; i < maxNumSubframes; i++) {
            if ((Params.guiMonitor[i].logMagRange == 1) || (Params.guiMonitor[i].noiseProfile == 1) ||
                (Params.guiMonitor[i].rangeAzimuthHeatMap == 1) || (Params.guiMonitor[i].rangeDopplerHeatMap == 1) ||
                (Params.guiMonitor[i].statsInfo == 1)) {
                return i;
            }
        }

    }

    /* xWR14xx and xWR16xx legacy frame are always located in index zero as there is no concept of subframe*/
    return 0;
};


/* 
- For xWR14xx and xWR16xx/18xx legacy frame are always located in index zero as there is no concept of subframe.
  In this case, this function will return Params.guiMonitor[0].detectedObjects.
- In the case of advanced frame :
  In this case, this function will return one if any subframe has detected objects enabled.
*/
var checkDetectedObjectsSetting = function (Params) {
    var i;

    /*Is this advanced frame config mode?*/
    if (((Params.platform == mmwInput.Platform.xWR16xx) ||
        (Params.platform == mmwInput.Platform.xWR18xx) ||
        (Params.platform == mmwInput.Platform.xWR68xx)) && (Params.dfeDataOutputMode.mode == 3)) {
        /* need to find the first GUI monitor command that has the detected obj
           plot enabled */
        for (i = 0; i < maxNumSubframes; i++) {
            if (Params.guiMonitor[i].detectedObjects > 0) {
                return 1; //enabled  
            }
        }
    }
    else {
        if(Params.guiMonitor[0].detectedObjects > 0)
        {
            return 1;
        }
        else 
        {
            return 0;
        }
    }

    /* default disabled if no subframe is found*/
    return 0;
};

var processRangeNoiseProfile = function (bytevec, byteVecIdx, Params, isRangeProfile, detObjRes) {
    var elapsed_time = {}; // for profile this code only

    var subFrameNum = Params.currentSubFrameNumber;
    if (subFrameNum != Params.subFrameToPlot) return;

    if (isRangeProfile && Params.guiMonitor[subFrameNum].logMagRange != 1) return;
    if (isRangeProfile == false && Params.guiMonitor[subFrameNum].noiseProfile != 1) return;
    var traceIdx = isRangeProfile ? 0 : 2;

    //if (Params.guiMonitor.logMagRange == 1) {
    var start_time = new Date().getTime();
    // %bytes corresponding to range profile are in rp
    var rp = bytevec.slice(byteVecIdx, byteVecIdx + Params.dataPath[subFrameNum].numRangeBins * 2);
    rp = math.add(
        math.subset(rp, math.index(math.range(0, Params.dataPath[subFrameNum].numRangeBins * 2, 2))),
        math.multiply(math.subset(rp, math.index(math.range(1, Params.dataPath[subFrameNum].numRangeBins * 2, 2))), 256)
    );
    if (Params.rangeProfileLogScale == false) {
        math.forEach(rp, function (value, idx, ary) {
            ary[idx] = Params.dspFftScaleCompAll_lin[subFrameNum] * Math.pow(2, value * Params.log2linScale[subFrameNum]);
        });
    } else {
        math.forEach(rp, function (value, idx, ary) {
            ary[idx] = value * Params.log2linScale[subFrameNum] * Params.toDB + Params.dspFftScaleCompAll_log[subFrameNum];
        });
    }
    var rp_x = math.multiply(math.range(0, Params.dataPath[subFrameNum].numRangeBins), Params.dataPath[subFrameNum].rangeIdxToMeters).valueOf();
    rp_x = math.subtract(rp_x, Params.compRxChanCfg.rangeBias); //correct regardless of state (measurement or compensation)
    math.forEach(rp_x, function (value, idx, ary) {
        ary[idx] = math.max(ary[idx], 0);
    });

    var update = { x: [], y: [] };

    if ((Params.platform == mmwInput.Platform.xWR16xx) ||
        (Params.platform == mmwInput.Platform.xWR18xx) ||
        (Params.platform == mmwInput.Platform.xWR68xx)) {
        switch (Params.currentSubFrameNumber) {
            case 0:
                {
                    templateObj.$.ti_widget_plot2.data[0].line.color = "rgb(0,0,255)";
                    break;
                }
            case 1:
                {
                    templateObj.$.ti_widget_plot2.data[0].line.color = "rgb(0,0,255)";
                    break;
                }
            case 2:
                {
                    templateObj.$.ti_widget_plot2.data[0].line.color = "rgb(0,0,255)";
                    break;
                }
            case 3:
                {
                    templateObj.$.ti_widget_plot2.data[0].line.color = "rgb(0,0,255)";
                    break;
                }
        }
    }

    templateObj.$.ti_widget_plot2.data[traceIdx].x = rp_x;
    templateObj.$.ti_widget_plot2.data[traceIdx].y = rp.valueOf();
        
    if (isRangeProfile == true && detObjRes) {
        if (detObjRes.rangeIdx) {
            var rp_det = []; //math.zeros(math.size(rp)).valueOf();
            var rp_det_x = [];
            math.forEach(detObjRes.rangeIdx, function (value, idx) {
                // caution the content of x(1,:) is range index, is this indexing 1-based or 0-based in target code?
                if (detObjRes.dopplerIdx[idx] == 0) {
                    //rp_det[value] = rp[value];
                    rp_det.push(rp[value]);
                    rp_det_x.push(rp_x[value]);
                }
            });
            
            templateObj.$.ti_widget_plot2.data[1].x = rp_det_x;
            templateObj.$.ti_widget_plot2.data[1].y = rp_det;
        } else {
            templateObj.$.ti_widget_plot2.data[1].x = [];
            templateObj.$.ti_widget_plot2.data[1].y = [];
        }
    }
    templateObj.$.ti_widget_plot2.redrawdata();
    elapsed_time.logMagRange = new Date().getTime() - start_time;
    //}
};

var processAzimuthHeatMap = function (bytevec, byteVecIdx, Params) {
    var elapsed_time = {}; // for profile this code only
    var subFrameNum = Params.currentSubFrameNumber;

    if (subFrameNum != Params.subFrameToPlot) return;

    if (Params.guiMonitor[subFrameNum].rangeAzimuthHeatMap == 1) {
        var start_time = new Date().getTime();
        // %Range complex bins at zero Doppler all virtual (azimuth) antennas
        var numBytes = Params.dataPath[subFrameNum].numTxAzimAnt *
            Params.dataPath[subFrameNum].numRxAnt *
            Params.dataPath[subFrameNum].numRangeBins * 4;
        var q = bytevec.slice(byteVecIdx, byteVecIdx + numBytes);
        // q = q(1:2:end)+q(2:2:end)*2^8;
        // q(q>32767) = q(q>32767) - 65536;
        // q = q(1:2:end)+1j*q(2:2:end);
        // ==>  q[4*idx+1]q[4*idx+0] is real, q[4*idx+3]q[4*idx+2] is imag,
        // q = reshape(q, Params.dataPath.numTxAzimAnt*Params.dataPath.numRxAnt, Params.dataPath.numRangeBins);
        // Q = fft(q, NUM_ANGLE_BINS);  % column based NUM_ANGLE_BINS-point fft, padded with zeros
        // QQ=fftshift(abs(Q),1);
        // QQ=QQ.';
        var qrows = Params.dataPath[subFrameNum].numTxAzimAnt * Params.dataPath[subFrameNum].numRxAnt, qcols = Params.dataPath[subFrameNum].numRangeBins;
        var qidx = 0;
        var QQ = [];
        for (var tmpc = 0; tmpc < qcols; tmpc++) {
            var real = math.zeros(NUM_ANGLE_BINS).valueOf();
            var imag = math.zeros(NUM_ANGLE_BINS).valueOf();
            for (var tmpr = 0; tmpr < qrows; tmpr++) {
                real[tmpr] = q[qidx + 1] * 256 + q[qidx];
                if (real[tmpr] > 32767) real[tmpr] = real[tmpr] - 65536;
                imag[tmpr] = q[qidx + 3] * 256 + q[qidx + 2];
                if (imag[tmpr] > 32767) imag[tmpr] = imag[tmpr] - 65536;
                qidx = qidx + 4;
            }
            fft.transform(real, imag);
            for (var ri = 0; ri < NUM_ANGLE_BINS; ri++) {
                real[ri] = Math.sqrt(real[ri] * real[ri] + imag[ri] * imag[ri]); // abs()
            }
            QQ.push(real.slice(NUM_ANGLE_BINS / 2).concat(real.slice(0, NUM_ANGLE_BINS / 2)));
        }
        // QQ=QQ(:,2:end);
        // fliplr(QQ)            
        var fliplrQQ = [];
        for (var tmpr = 0; tmpr < QQ.length; tmpr++) {
            fliplrQQ.push(QQ[tmpr].slice(1).reverse());
        }
        var start_time2 = new Date().getTime();
        if (Params.rangeAzimuthHeatMapGridInit == 0) {
            // theta = asind([-NUM_ANGLE_BINS/2+1 : NUM_ANGLE_BINS/2-1]'*(2/NUM_ANGLE_BINS));
            // range = [0:Params.dataPath.numRangeBins-1] * Params.dataPath.rangeIdxToMeters;
            var theta = math.asin(math.dotMultiply(math.range(-NUM_ANGLE_BINS / 2 + 1, NUM_ANGLE_BINS / 2 - 1, true), 2 / NUM_ANGLE_BINS)).valueOf(); // in radian
            var range = math.dotMultiply(math.range(0, Params.dataPath[subFrameNum].numRangeBins - 1, true), Params.dataPath[subFrameNum].rangeIdxToMeters).valueOf();
            range = math.subtract(range, Params.compRxChanCfg.rangeBias); //correct regardless of state (measurement or compensation)
            math.forEach(range, function (value, idx, ary) {
                ary[idx] = math.max(ary[idx], 0);
            });

            // posX = range' * sind(theta');
            // posY = range' * cosd(theta');
            var posX = MyUtil.tensor(range, math.sin(theta));
            var posY = MyUtil.tensor(range, math.cos(theta));
            Params.rangeAzimuthHeatMapGrid_xlin = math.range(-range_width, range_width, 2.0 * range_width / (Params.rangeAzimuthHeatMapGrid_points - 1), true).valueOf();
            if (Params.rangeAzimuthHeatMapGrid_xlin.length < Params.rangeAzimuthHeatMapGrid_points) Params.rangeAzimuthHeatMapGrid_xlin.push(range_width);
            Params.rangeAzimuthHeatMapGrid_ylin = math.range(0, range_depth, 1.0 * range_depth / (Params.rangeAzimuthHeatMapGrid_points - 1), true).valueOf();
            if (Params.rangeAzimuthHeatMapGrid_ylin.length < Params.rangeAzimuthHeatMapGrid_points) Params.rangeAzimuthHeatMapGrid_ylin.push(range_depth);
            var xiyi = MyUtil.meshgrid(Params.rangeAzimuthHeatMapGrid_xlin, Params.rangeAzimuthHeatMapGrid_ylin);
            Params.rangeAzimuthHeatMapGrid = new math_griddata();
            Params.rangeAzimuthHeatMapGrid.init(math.flatten(posX), math.flatten(posY), xiyi[0], xiyi[1]);
            Params.rangeAzimuthHeatMapGridInit = 1;
        }
        var zi = Params.rangeAzimuthHeatMapGrid.griddata_from_cache(math.flatten(fliplrQQ));
        zi = MyUtil.reshape_rowbased(zi, Params.rangeAzimuthHeatMapGrid_ylin.length, Params.rangeAzimuthHeatMapGrid_xlin.length);

		
		////////////////////////////////////////////////////////////////////////////////////////////////////
		zi=zi.slice(0,32)
        // Send Range Doppler heatmap to the server
        client.write(JSON.stringify(zi));

		////////////////////////////////////////////////////////////////////////////////////////////////////
        var start_time3 = new Date().getTime();
        
        templateObj.$.ti_widget_plot4.data[0].x = Params.rangeAzimuthHeatMapGrid_xlin;
        templateObj.$.ti_widget_plot4.data[0].y = Params.rangeAzimuthHeatMapGrid_ylin;
        templateObj.$.ti_widget_plot4.data[0].z = zi;
        templateObj.$.ti_widget_plot4.redrawdata();
        
        elapsed_time.rangeAzimuthHeatMap = [start_time2 - start_time, start_time3 - start_time2, new Date().getTime() - start_time3];
    }
};

var processRangeDopplerHeatMap = function (bytevec, byteVecIdx, Params) {
    var elapsed_time = {}; // for profile this code only
    var subFrameNum = Params.currentSubFrameNumber;

    if (subFrameNum != Params.subFrameToPlot) return;

    if (Params.guiMonitor[subFrameNum].rangeDopplerHeatMap == 1) {
        var start_time = new Date().getTime();
        // %Get the whole log magnitude range dopppler matrix
        var numBytes = Params.dataPath[subFrameNum].numDopplerBins * Params.dataPath[subFrameNum].numRangeBins * 2;
        var rangeDoppler = bytevec.slice(byteVecIdx, byteVecIdx + numBytes);
        // rangeDoppler = rangeDoppler(1:2:end) + rangeDoppler(2:2:end)*256;
        rangeDoppler = math.add(
            math.subset(rangeDoppler, math.index(math.range(0, numBytes, 2))),
            math.multiply(math.subset(rangeDoppler, math.index(math.range(1, numBytes, 2))), 256)
        );
        rangeDoppler = MyUtil.reshape(rangeDoppler, Params.dataPath[subFrameNum].numDopplerBins, Params.dataPath[subFrameNum].numRangeBins);
        // rangeDoppler = fftshift(rangeDoppler,1);
		

		
        rangeDoppler = rangeDoppler.slice((rangeDoppler.length + 1) / 2).concat(rangeDoppler.slice(0, (rangeDoppler.length + 1) / 2));
		
		////////////////////////////////////////////////////////////////////////////////////////////////////
        // Send Range Doppler heatmap to the server
        //client.write(JSON.stringify(rangeDoppler));

		////////////////////////////////////////////////////////////////////////////////////////////////////
		
        var range = math.dotMultiply(math.range(0, Params.dataPath[subFrameNum].numRangeBins - 1, true), Params.dataPath[subFrameNum].rangeIdxToMeters);
        range = math.subtract(range, Params.compRxChanCfg.rangeBias); //correct regardless of state (measurement or compensation)
        math.forEach(range, function (value, idx, ary) {
            ary[idx] = math.max(ary[idx], 0);
        });

        var dopplermps = math.dotMultiply(math.range(-Params.dataPath[subFrameNum].numDopplerBins / 2,
            Params.dataPath[subFrameNum].numDopplerBins / 2 - 1, true),
            Params.dataPath[subFrameNum].dopplerResolutionMps);
            
        templateObj.$.ti_widget_plot3.data[0].x = range.valueOf();
        templateObj.$.ti_widget_plot3.data[0].y = dopplermps.valueOf();
        templateObj.$.ti_widget_plot3.data[0].z = rangeDoppler;
        templateObj.$.ti_widget_plot3.redrawdata();
        
        elapsed_time.rangeDopplerHeatMap = new Date().getTime() - start_time;
    }
    return elapsed_time;
};

var processSideInfo = function (bytevec, byteVecIdx, Params) {
    var subFrameNum = Params.currentSubFrameNumber;
    var numDetectedObj = 0;
    var snrVal;
    var noiseVal;
    var snrDB;
    var noiseDB;
    
    numDetectedObj = Params.numDetectedObj[subFrameNum];
    
    /* Side info structure per detected object 
       typedef struct DPIF_PointCloudSideInfo_t
       {
           snr - CFAR cell to side noise ratio in dB expressed in 0.1 steps of dB 
           int16_t  snr;
           y - CFAR noise level of the side of the detected cell in dB expressed in 0.1 steps of dB 
           int16_t  noise;
       }DPIF_PointCloudSideInfo;
    */

    /* Size of side info structure in bytes */
    var sizeofInfo = 4;
    var x = bytevec.slice(byteVecIdx, byteVecIdx + sizeofInfo * numDetectedObj);
    x = MyUtil.reshape(x, sizeofInfo, numDetectedObj);

    snrVal = math.add(x[0], math.multiply(x[1], 256));
    
    math.forEach(snrVal, function (value, idx, ary) {
        if (value > 32767) {
            ary[idx] = ary[idx] - 65536;
        }
    });
    
    var snrDB = math.map(snrVal, function (value) {
        return value * 0.1;
    });

    noiseVal = math.add(x[2], math.multiply(x[3], 256));
    
    math.forEach(noiseVal, function (value, idx, ary) {
        if (value > 32767) {
            ary[idx] = ary[idx] - 65536;
        }
    });
    
    var noiseDB = math.map(noiseVal, function (value) {
        return value * 0.1;
    });
    
    return {snrDB: snrDB, noiseDB: noiseDB}

}

var processStatistics = function (bytevec, byteVecIdx, Params) {
	

    var subFrameNum = Params.currentSubFrameNumber;
    //if(subFrameNum != Params.subFrameToPlot) return;
    if (Params.guiMonitor[subFrameNum].statsInfo == 1) {
        Params.interFrameProcessingTime[subFrameNum] = math.sum(math.dotMultiply(bytevec.slice(byteVecIdx, byteVecIdx + 4), byte_mult));
        byteVecIdx += 4;

        Params.transmitOutputTime[subFrameNum] = math.sum(math.dotMultiply(bytevec.slice(byteVecIdx, byteVecIdx + 4), byte_mult));
        byteVecIdx += 4;

        Params.interFrameProcessingMargin[subFrameNum] = math.sum(math.dotMultiply(bytevec.slice(byteVecIdx, byteVecIdx + 4), byte_mult));
        byteVecIdx += 4;

        Params.interChirpProcessingMargin[subFrameNum] = math.sum(math.dotMultiply(bytevec.slice(byteVecIdx, byteVecIdx + 4), byte_mult));
        byteVecIdx += 4;

        Params.activeFrameCPULoad[subFrameNum] = math.sum(math.dotMultiply(bytevec.slice(byteVecIdx, byteVecIdx + 4), byte_mult));
        byteVecIdx += 4;

        Params.interFrameCPULoad[subFrameNum] = math.sum(math.dotMultiply(bytevec.slice(byteVecIdx, byteVecIdx + 4), byte_mult));
        byteVecIdx += 4;

        tSummaryTab('Profiling');

        if (subFrameNum == Params.subFrameToPlot) {
            Params.stats.activeFrameCPULoad.shift(); Params.stats.activeFrameCPULoad.push(Params.activeFrameCPULoad[subFrameNum]);
            Params.stats.interFrameCPULoad.shift(); Params.stats.interFrameCPULoad.push(Params.interFrameCPULoad[subFrameNum]);
            templateObj.$.ti_widget_plot5.data[0].y = Params.stats.activeFrameCPULoad;
            templateObj.$.ti_widget_plot5.data[1].y = Params.stats.interFrameCPULoad;
            templateObj.$.ti_widget_plot5.redrawdata();
        }
    }
};

var positionPlot = function (plot, display, posIdx) {
    var left = [0, 500, 0, 500, 0];
    var top = [0, 0, 500, 500, 900];
    // layout.margin = {t:100,b:80,l:80,r:80}
    var width = 480; // initial setting in index.gui file
    var height = 480 - 160 + 180;
    plot.layout.autoresize = false;
    plot.layout.height = height;
    plot.layout.width = width;
    if (display) {
        plot.style.display = 'block';
        plot.style.left = left[posIdx] + 'px';
        plot.style.top = top[posIdx] + 'px';
    } else {
        plot.style.display = 'none';
    }
};

/*Function that returns the maximum range_width
  for all subframes.*/
var getMaxRangeWidth = function (Params) {
    var localWidth;
    var maxWidth = 0;

    for (var i = 0; i < maxNumSubframes; i++) {
        localWidth = MyUtil.toPrecision((Params.dataPath[i].rangeIdxToMeters * Params.dataPath[i].numRangeBins) / 2, 2);
        if (localWidth > maxWidth)
            maxWidth = localWidth;
    }

    reflectTextbox(templateObj.$.ti_widget_textbox_width, maxWidth);
    return maxWidth;
}

/*Function that returns the maximum range_depth
  for all subframes.*/
var getMaxRangeDepth = function (Params) {
    var localDepth;
    var maxDepth = 0;

    for (var i = 0; i < maxNumSubframes; i++) {
        localDepth = MyUtil.toPrecision(Params.dataPath[i].rangeIdxToMeters * Params.dataPath[i].numRangeBins, 2);
        if (localDepth > maxDepth)
            maxDepth = localDepth;
    }

    reflectTextbox(templateObj.$.ti_widget_textbox_depth, maxDepth);
    return maxDepth;
}

/*Function that returns the maximum doppler-range
  for all subframes.*/
var getMaxDopplerRange = function (Params) {
    var localDopplerRange;
    var maxDopplerRange = 0;

    if (Params.dfeDataOutputMode.mode == 3) {
        /*advanced frame cfg*/
        for (var i = 0; i < maxNumSubframes; i++) {
            localDopplerRange = Params.dataPath[i].dopplerResolutionMps * Params.dataPath[i].numDopplerBins / 2;
            if (Params.extendedMaxVelocity[i].enable) {
                localDopplerRange = localDopplerRange * 2;
            }

            if (localDopplerRange > maxDopplerRange)
                maxDopplerRange = localDopplerRange;
        }
    }
    else {
        /*legacy frame cfg*/
        maxDopplerRange = Params.dataPath[0].dopplerResolutionMps * Params.dataPath[0].numDopplerBins / 2;
        if (Params.extendedMaxVelocity[0].enable) {
            maxDopplerRange = maxDopplerRange * 2;
        }

    }

    return maxDopplerRange;
}



var setupPlots = function (Params) {
    //range_depth
    var subFrameNum = Params.subFrameToPlot;

    var tmp = parseFloat(templateObj.$.ti_widget_textbox_depth.getText());
    if (tmp != NaN) { range_depth = Math.abs(tmp); }
    if (range_depth > (Params.dataPath[subFrameNum].rangeIdxToMeters * Params.dataPath[subFrameNum].numRangeBins)) {
        range_depth = MyUtil.toPrecision(Params.dataPath[subFrameNum].rangeIdxToMeters * Params.dataPath[subFrameNum].numRangeBins, 2);
        reflectTextbox(templateObj.$.ti_widget_textbox_depth, range_depth);
    }
    // range_width
    tmp = parseFloat(templateObj.$.ti_widget_textbox_width.getText());
    if (tmp != NaN) { range_width = Math.abs(tmp); }
    if (range_width > (Params.dataPath[subFrameNum].rangeIdxToMeters * Params.dataPath[subFrameNum].numRangeBins / 2)) {
        range_width = MyUtil.toPrecision((Params.dataPath[subFrameNum].rangeIdxToMeters * Params.dataPath[subFrameNum].numRangeBins) / 2, 2);
        reflectTextbox(templateObj.$.ti_widget_textbox_width, range_width);
    }
    tmp = parseFloat(templateObj.$.ti_widget_textbox_rpymax.getText());
    if (tmp != NaN) { maxRangeProfileYaxis = Math.abs(tmp); }
    Params.rangeProfileLogScale = templateObj.$.ti_widget_checkbox_rplogscale.checked;
    Params.rangeAzimuthHeatMapGridInit = 0;
    var plotPosIdx = 0;
    templateObj.$.ti_widget_image_cb.visible = false;
    templateObj.$.ti_widget_label_cbmin.visible = false;
    templateObj.$.ti_widget_label_cbmax.visible = false;
    if (Params.detectedObjectsToPlot == 1) {
        if (Params.dataPath[subFrameNum].numTxElevAnt == 1) {
            templateObj.$.ti_widget_plot1.data = [
                {
                    type: 'scatter3d', mode: 'markers',
                    marker: { size: 3 }, name: 'Detected Objects'
                }
            ];
            templateObj.$.ti_widget_plot1.layout.title = '3D Scatter Plot';
            templateObj.$.ti_widget_plot1.layout.margin = { t: 100, b: 10, l: 10, r: 10 };
            delete templateObj.$.ti_widget_plot1.layout.plot_bgcolor;
            delete templateObj.$.ti_widget_plot1.layout.xaxis;
            delete templateObj.$.ti_widget_plot1.layout.yaxis;
            templateObj.$.ti_widget_plot1.layout.scene = {
                xaxis: {
                    title: 'X in meters',
                    nticks: 5,
                    range: [-range_width, range_width]
                },
                yaxis: {
                    title: 'Y in meters',
                    nticks: 5,
                    range: [0, range_depth]
                },
                zaxis: {
                    title: 'Z',
                    nticks: 5,
                    range: [-range_width, range_width]
                },
                camera: {
                    center: { x: 0, y: 0, z: -0.3 },
                    eye: { x: 1.5, y: 1.5, z: 0.1 },
                    up: { x: 0, y: 0, z: 1 }
                }
            };
        } else {
            var rectgrid = 'polar grid 2' == 'rect grid'; //MMWSDK-1224
            templateObj.$.ti_widget_plot1.data = [
                {
                    type: 'scatter', mode: 'markers', name: 'Detected Objects',
                    marker: { size: 4, color: 'rgb(0,255,0)', showscale: false }
                }
            ];
            templateObj.$.ti_widget_plot1.layout.title = 'X-Y Scatter Plot';
            if (Params.dfeDataOutputMode.mode == 3) {
                var sep = '';
                var sf_idx;
                templateObj.$.ti_widget_plot1.layout.title += '(Subframe:';
                for (sf_idx = 0; sf_idx < Params.advFrameCfg.numOfSubFrames; sf_idx++) {
                    if (Params.guiMonitor[sf_idx].detectedObjects > 0) {
                        templateObj.$.ti_widget_plot1.layout.title += sep + sf_idx;
                        sep = ', ';
                    }
                }
                templateObj.$.ti_widget_plot1.layout.title += ')';
            }
            delete templateObj.$.ti_widget_plot1.layout.margin;
            templateObj.$.ti_widget_plot1.layout.plot_bgcolor = 'rgb(0,0,96)';
            var scatterRangeWidth = range_width;
            var scatterRangeDepth = range_depth;
            if (Params.dfeDataOutputMode.mode == 3) {
                scatterRangeWidth = getMaxRangeWidth(Params);
                scatterRangeDepth = getMaxRangeDepth(Params);
            }
            templateObj.$.ti_widget_plot1.layout.xaxis = {
                title: 'Distance along lateral axis (meters)',
                showgrid: rectgrid,
                //zerolinecolor: 'rgb(128,128,128)',
                autorange: false,
                range: [-scatterRangeWidth, scatterRangeWidth]
            };

            var radii = [];
            var angles = [];
            for (var i = 1; i <= 4; i++) {
                radii.push(i * scatterRangeDepth / 4);
            }
            for (var i = 0; i < 5; i++ , idx += 1) {
                //if (i==2) continue; // skip the main vertical line
                angles.push(math.pi / 6 + i * math.pi * 2 / 12);
            }
            templateObj.$.ti_widget_plot1.layout.yaxis = {
                title: 'Distance along longitudinal axis (meters)',
                showgrid: rectgrid,
                autorange: false,
                dtick: radii[1] - radii[0], //MMWSDK-1224 bug fix
                range: [0, radii[radii.length - 1]] //MMWSDK-1224 bug fix
            };
            var points = 16;
            var w = math.range(math.pi / 6, 5 * math.pi / 6, (4 * math.pi / 6) / (points), true).valueOf();
            if (w.length < points) w.push(5 * math.pi / 6);
            var idx = 1;
            //for (var r=0.5; r <= range_depth; r += 0.5, idx+=1) {
            for (var i = 0; i < radii.length; i++ , idx += 1) {
                var r = radii[i]
                var x = math.map(w, function (value) { return r * math.cos(value) });
                var y = math.map(w, function (value) { return r * math.sin(value) });
                var arc = {
                    type: 'scatter', mode: 'lines', line: { color: 'rgb(128,128,128)', width: 1 },
                    showlegend: false, hoverinfo: 'none',
                    x: x, y: y
                };
                templateObj.$.ti_widget_plot1.data.push(arc);
            }
            for (var i = 0; i < angles.length; i++ , idx += 1) {
                var angle = angles[i];
                var line = {
                    type: 'scatter', mode: 'lines', line: { color: 'rgb(128,128,128)', width: 1 },
                    showlegend: false, hoverinfo: 'none',
                    x: [0, scatterRangeDepth * math.cos(angle)], y: [0, scatterRangeDepth * math.sin(angle)]
                };
                templateObj.$.ti_widget_plot1.data.push(line);
            }
        }//end of 2-D scatter plot
        templateObj.$.ti_widget_plot1.layout.showlegend = false;
        positionPlot(templateObj.$.ti_widget_plot1, true, plotPosIdx++);
        templateObj.$.ti_widget_plot1.redraw();
    } else {
        positionPlot(templateObj.$.ti_widget_plot1, false);
    }
    if (Params.guiMonitor[subFrameNum].logMagRange == 1 || Params.guiMonitor[subFrameNum].noiseProfile == 1) {
        if (Params.platform == mmwInput.Platform.xWR14xx) {
            templateObj.$.ti_widget_plot2.data = [
                { type: 'scatter', mode: 'lines', name: 'Range Profile', x: [null], y: [null] } // data[0] range profile
                , { type: 'scatter', mode: 'markers', name: 'Detected Points', x: [null], y: [null] } // data[1] range profile at detected objs
                , { type: 'scatter', mode: 'lines', name: 'Noise Profile', x: [null], y: [null] } // data[2] noise profile
            ];
        }
        else if ((Params.platform == mmwInput.Platform.xWR16xx) ||
            (Params.platform == mmwInput.Platform.xWR18xx) ||
            (Params.platform == mmwInput.Platform.xWR68xx)) {
            templateObj.$.ti_widget_plot2.data = [
                { type: 'scatter', mode: 'lines', line: { color: 'rgb(0,0,255)', width: 1 }, name: 'Range Profile', x: [null], y: [null] } // data[0] range profile
                , { type: 'scatter', mode: 'markers', name: 'Detected Points', x: [null], y: [null] } // data[1] range profile at detected objs
                , { type: 'scatter', mode: 'lines', name: 'Noise Profile', x: [null], y: [null] } // data[2] noise profile
            ];
        }

        templateObj.$.ti_widget_plot2.layout.title = 'Range Profile for zero Doppler';
        if (Params.dfeDataOutputMode.mode == 3) {
            templateObj.$.ti_widget_plot2.layout.title += '(Subframe:' + subFrameNum + ')';
        }
        templateObj.$.ti_widget_plot2.layout.xaxis = {
            title: 'Range (meters)',
            autorange: false,
            range: [0, Params.dataPath[subFrameNum].rangeIdxToMeters * Params.dataPath[subFrameNum].numRangeBins]
        };
        var ymax = maxRangeProfileYaxis;
        var y_title = "Relative Power ";
        if (Params.rangeProfileLogScale == true) {
            ymax = Math.log2(maxRangeProfileYaxis) * Params.toDB;
            y_title = y_title + '(dB)';
        }
        else {
            y_title = y_title + '(linear)';
        }
        templateObj.$.ti_widget_plot2.layout.yaxis = {
            title: y_title,
            autorange: false,
            range: [0, ymax]
        };
        templateObj.$.ti_widget_plot2.layout.showlegend = true;
        positionPlot(templateObj.$.ti_widget_plot2, true, plotPosIdx++);
        templateObj.$.ti_widget_plot2.redraw();
    } else {
        templateObj.$.ti_widget_plot2.layout.showlegend = true;
        positionPlot(templateObj.$.ti_widget_plot2, false);
    }
    if (Params.guiMonitor[subFrameNum].rangeDopplerHeatMap == 1) {
        templateObj.$.ti_widget_image_cb.visible = true;
        templateObj.$.ti_widget_label_cbmin.visible = true;
        templateObj.$.ti_widget_label_cbmax.visible = true;

        templateObj.$.ti_widget_plot3.data = [
            {
                type: 'heatmap', //'heatmapgl'
                zauto: true,
                zsmooth: 'fast', //'false'
                //connectgaps: false,
                colorscale: 'Jet',
                showscale: false
            }
        ];
        var dopplerRange = Params.dataPath[subFrameNum].dopplerResolutionMps * (Params.dataPath[subFrameNum].numDopplerBins / 2 - 1);
        templateObj.$.ti_widget_plot3.layout.title = 'Doppler-Range Heatmap';
        if (Params.dfeDataOutputMode.mode == 3) {
            templateObj.$.ti_widget_plot3.layout.title += '(Subframe:' + subFrameNum + ')';
        }
        delete templateObj.$.ti_widget_plot3.layout.plot_bgcolor;
        templateObj.$.ti_widget_plot3.layout.xaxis = {
            title: 'Range (meters)',
            autorange: false,
            range: [0, range_depth]
        };
        templateObj.$.ti_widget_plot3.layout.yaxis = {
            title: 'Doppler (m/s)',
            autorange: false,
            range: [-dopplerRange, dopplerRange]
        };
        positionPlot(templateObj.$.ti_widget_plot3, true, plotPosIdx++);
        templateObj.$.ti_widget_plot3.redraw();
    } else if ((Params.detectedObjectsToPlot == 1) && (Params.guiMonitor[subFrameNum].rangeDopplerHeatMap == 0)) {
        templateObj.$.ti_widget_plot3.data = [
            {
                type: 'scatter', mode: 'markers', name: 'Detected Objects',
                marker: { size: 4, color: 'rgb(0,255,0)', showscale: false }
            }
        ];
        var dopplerRange = getMaxDopplerRange(Params);
        templateObj.$.ti_widget_plot3.layout.title = 'Doppler-Range Plot';
        if (Params.dfeDataOutputMode.mode == 3) {
            var sep = '';
            var sf_idx;
            templateObj.$.ti_widget_plot3.layout.title += '(Subframe:';
            for (sf_idx = 0; sf_idx < Params.advFrameCfg.numOfSubFrames; sf_idx++) {
                if (Params.guiMonitor[sf_idx].detectedObjects > 0) {
                    templateObj.$.ti_widget_plot3.layout.title += sep + sf_idx;
                    sep = ', ';
                }
            }
            templateObj.$.ti_widget_plot3.layout.title += ')';
        }
        templateObj.$.ti_widget_plot3.layout.plot_bgcolor = 'rgb(0,0,96)'
        templateObj.$.ti_widget_plot3.layout.xaxis = {
            title: 'Range (meters)',
            gridcolor: 'rgb(68,68,68)',
            autorange: false,
            range: [0, scatterRangeDepth]
        };
        templateObj.$.ti_widget_plot3.layout.yaxis = {
            title: 'Doppler (m/s)',
            gridcolor: 'rgb(68,68,68)',
            zerolinecolor: 'rgb(128,128,128)',
            autorange: false,
            range: [-dopplerRange, dopplerRange]
        };
        positionPlot(templateObj.$.ti_widget_plot3, true, plotPosIdx++);
        templateObj.$.ti_widget_plot3.redraw();
    } else {
        positionPlot(templateObj.$.ti_widget_plot3, false);
    }
    if (Params.guiMonitor[subFrameNum].rangeAzimuthHeatMap == 1) {
        templateObj.$.ti_widget_image_cb.visible = true;
        templateObj.$.ti_widget_label_cbmin.visible = true;
        templateObj.$.ti_widget_label_cbmax.visible = true;
        templateObj.$.ti_widget_plot4.data = [
            {
                type: 'heatmap', //'heatmapgl',
                zauto: true,
                zsmooth: false, //'best','fast',false;
                connectgaps: true, //false
                colorscale: 'Jet',
                showscale: false
            }
        ];
        templateObj.$.ti_widget_plot4.layout.title = 'Azimuth-Range Heatmap';
        if (Params.dfeDataOutputMode.mode == 3) {
            templateObj.$.ti_widget_plot4.layout.title += '(Subframe:' + subFrameNum + ')';
        }
        templateObj.$.ti_widget_plot4.layout.xaxis = {
            title: 'Distance along lateral axis (meters)',
            autorange: false,
            range: [-range_width, range_width]
        };
        templateObj.$.ti_widget_plot4.layout.yaxis = {
            title: 'Distance along longitudinal axis (meters)',
            autorange: false,
            range: [0, range_depth]
        };
        //templateObj.$.ti_widget_plot4.layout.autoresize=false;
        //templateObj.$.ti_widget_plot4.layout.height = height;
        //templateObj.$.ti_widget_plot4.layout.width = width;
        if (2 * range_width > range_depth) {
            var tmp = range_depth / (2 * range_width);
            templateObj.$.ti_widget_plot4.layout.yaxis.domain = [0.5 - tmp / 2, 0.5 + tmp / 2.0];
        } else if (2 * range_width < range_depth) {
            var tmp = (2 * range_width) / range_depth;
            templateObj.$.ti_widget_plot4.layout.xaxis.domain = [0.5 - tmp / 2, 0.5 + tmp / 2.0];
        }
        positionPlot(templateObj.$.ti_widget_plot4, true, plotPosIdx++);
        templateObj.$.ti_widget_plot4.redraw();
    } else {
        positionPlot(templateObj.$.ti_widget_plot4, false);
    }
    if (Params.guiMonitor[subFrameNum].statsInfo == 1) {
        templateObj.$.ti_widget_plot5.data = [
            { type: 'scatter', mode: 'lines', name: 'Active frame', y: [0] } // data[0] activeFrameCPULoad
            , { type: 'scatter', mode: 'lines', name: 'Interframe', y: [0] } // data[1] interFrameCPULoad
        ];
        var title = 'CPU Load';
        if (Params.platform == mmwInput.Platform.xWR14xx) {
            title = 'Active and Interframe CPU (R4F) load';
        } else if (Params.platform == mmwInput.Platform.xWR16xx) {
            title = 'Active and Interframe  CPU (C674x) Load';
        } else if (Params.platform == mmwInput.Platform.xWR18xx) {
            title = 'Active and Interframe  CPU Load';
        } else if (Params.platform == mmwInput.Platform.xWR68xx) {
            title = 'Active and Interframe  CPU Load';
        }
        templateObj.$.ti_widget_plot5.layout.title = title;
        if (Params.dfeDataOutputMode.mode == 3) {
            templateObj.$.ti_widget_plot5.layout.title += '(Subframe:' + subFrameNum + ')';
        }
        templateObj.$.ti_widget_plot5.layout.xaxis = {
            title: 'Frames',
            autorange: false,
            range: [0, 100]
        };
        templateObj.$.ti_widget_plot5.layout.yaxis = {
            title: '% CPU Load',
            autorange: false,
            range: [0, 100]
        };
        positionPlot(templateObj.$.ti_widget_plot5, true, plotPosIdx++);
        templateObj.$.ti_widget_plot5.redraw();
    } else {
        positionPlot(templateObj.$.ti_widget_plot5, false);
    }
};
var updatePlotInputGroup = function (disable) {
    templateObj.$.ti_widget_textbox_depth.disabled = disable;
    templateObj.$.ti_widget_textbox_width.disabled = disable;
    templateObj.$.ti_widget_textbox_rpymax.disabled = disable;
    templateObj.$.ti_widget_checkbox_rplogscale.disabled = disable;
}
var onRangeProfileLogScale = function () {
    //console.log(templateObj.$.ti_widget_checkbox_rplogscale.checked);
};
var onSummaryTab = function (subset) {
    if (subset) templateObj.$.ti_widget_tabcontainer_summarytabs.selectedLabel = subset;
    else subset = templateObj.$.ti_widget_tabcontainer_summarytabs.selectedLabel;
    var showitem = 0;
    if (Params) {
        for (var idx = 1; idx <= 9; idx++) {
            templateObj.$['ti_widget_value' + idx].label = '';
        }
        var subFrameNum = Params.subFrameToPlot;
        var totalSubframes = 1;
        var sep = ', ';
        if (Params.dfeDataOutputMode.mode == 3) {
            /* This is advanced frame cfg */
            totalSubframes = Params.advFrameCfg.numOfSubFrames;
        }
        if (subset == 'Chirp/Frame') {
            for (subFrameNum = 0; subFrameNum < totalSubframes; subFrameNum++) {
                var profileCfgToPlot = Params.subFrameInfo[subFrameNum].profileCfgIndex;
                var periodicity = getFramePeriodicty(subFrameNum);
                if (subFrameNum == totalSubframes - 1) sep = '';

                templateObj.$.ti_widget_label1.label = 'Start Frequency (Ghz)';
                templateObj.$.ti_widget_value1.label += MyUtil.sprintf(Params.profileCfg[subFrameNum].startFreq_actual, 4) + sep;
                templateObj.$.ti_widget_label2.label = 'Slope (MHz/us)';
                templateObj.$.ti_widget_value2.label += MyUtil.sprintf(Params.profileCfg[profileCfgToPlot].freqSlopeConst_actual, 4) + sep;
                templateObj.$.ti_widget_label3.label = 'Samples per chirp';
                templateObj.$.ti_widget_value3.label += MyUtil.sprintf(Params.profileCfg[profileCfgToPlot].numAdcSamples, 4) + sep;
                templateObj.$.ti_widget_label4.label = 'Chirps per frame';
                templateObj.$.ti_widget_value4.label += MyUtil.sprintf(Params.dataPath[subFrameNum].numChirpsPerFrame, 4) + sep;
                templateObj.$.ti_widget_label5.label = 'Sampling rate (Msps)';
                templateObj.$.ti_widget_value5.label += MyUtil.sprintf(Params.profileCfg[profileCfgToPlot].digOutSampleRate / 1000, 4) + sep;
                templateObj.$.ti_widget_label6.label = 'Sweep Bandwidth (GHz)';
                templateObj.$.ti_widget_value6.label += MyUtil.sprintf(Params.profileCfg[profileCfgToPlot].freqSlopeConst_actual * Params.profileCfg[profileCfgToPlot].numAdcSamples / Params.profileCfg[profileCfgToPlot].digOutSampleRate, 4) + sep;
                templateObj.$.ti_widget_label7.label = 'Frame periodicity (msec)';
                templateObj.$.ti_widget_value7.label += MyUtil.sprintf(periodicity, 4) + sep;
                templateObj.$.ti_widget_label8.label = 'Transmit Antennas';
                templateObj.$.ti_widget_value8.label += MyUtil.sprintf(Params.dataPath[subFrameNum].numTxAnt, 4) + sep;//Number of Tx (MIMO)
                templateObj.$.ti_widget_label9.label = 'Receive Antennas';
                templateObj.$.ti_widget_value9.label += MyUtil.sprintf(Params.dataPath[subFrameNum].numRxAnt, 4) + sep;//Number of Tx (MIMO)
                showitem = 9;
            }
        } else if (subset == 'Scene') {
            for (subFrameNum = 0; subFrameNum < totalSubframes; subFrameNum++) {
                if (subFrameNum == totalSubframes - 1) sep = '';

                templateObj.$.ti_widget_label1.label = 'Range resolution (m)';
                templateObj.$.ti_widget_value1.label += MyUtil.sprintf(Params.dataPath[subFrameNum].rangeResolutionMeters, 4) + sep;
                templateObj.$.ti_widget_label2.label = 'Max Unambiguous Range (m)';
                templateObj.$.ti_widget_value2.label += MyUtil.sprintf(Params.dataPath[subFrameNum].rangeMeters, 4) + sep;
                templateObj.$.ti_widget_label3.label = 'Max Radial Velocity (m/s)';
                templateObj.$.ti_widget_value3.label += MyUtil.sprintf(Params.dataPath[subFrameNum].velocityMps, 4) + sep;
                templateObj.$.ti_widget_label4.label = 'Radial Velocity Resolution (m/s)';
                templateObj.$.ti_widget_value4.label += MyUtil.sprintf(Params.dataPath[subFrameNum].dopplerResolutionMps, 4) + sep;
                templateObj.$.ti_widget_label5.label = 'Azimuth Resolution (Deg)';
                templateObj.$.ti_widget_value5.label += Params.dataPath[subFrameNum].azimuthResolution + sep;
                showitem = 5;
            }
        } else if (subset == 'Profiling') {
            var addItem = 0;
            templateObj.$.ti_widget_label1.label = 'Platform';
            templateObj.$.ti_widget_value1.label = Params.tlv_platform ? '0x' + Params.tlv_platform.toString(16) : undefined;
            templateObj.$.ti_widget_label2.label = 'SDK Version';
            templateObj.$.ti_widget_value2.label = Params.tlv_version ? Params.tlv_version.reverse().join('.') : undefined;
            showitem += 2;
            for (subFrameNum = 0; subFrameNum < totalSubframes; subFrameNum++) {
                if (subFrameNum == totalSubframes - 1) sep = '';
                templateObj.$.ti_widget_label3.label = 'Number of Detected Objects';
                templateObj.$.ti_widget_value3.label += Params.numDetectedObj[subFrameNum] + sep;
                if (Params.guiMonitor[subFrameNum].statsInfo == 1) {
                    if (Params.dfeDataOutputMode.mode == 3) {
                        templateObj.$.ti_widget_label4.label = 'Stats for Subframe';
                        templateObj.$.ti_widget_value4.label += subFrameNum + sep;
                        templateObj.$.ti_widget_label6.label = ' subFrameProcessingMargin (usec)';
                        templateObj.$.ti_widget_value6.label += MyUtil.sprintf(Params.interFrameProcessingMargin[subFrameNum], 4) + sep;
                        templateObj.$.ti_widget_label7.label = ' subFrameProcessingTime (usec)';
                        templateObj.$.ti_widget_value7.label += MyUtil.sprintf(Params.interFrameProcessingTime[subFrameNum], 4) + sep;
                    }
                    else {
                        templateObj.$.ti_widget_label4.label = 'Frame stats';
                        templateObj.$.ti_widget_label6.label = ' InterFrameProcessingMargin (usec)';
                        templateObj.$.ti_widget_value6.label += MyUtil.sprintf(Params.interFrameProcessingMargin[subFrameNum], 4) + sep;
                        templateObj.$.ti_widget_label7.label = ' InterFrameProcessingTime (usec)';
                        templateObj.$.ti_widget_value7.label += MyUtil.sprintf(Params.interFrameProcessingTime[subFrameNum], 4) + sep;
                    }
                    templateObj.$.ti_widget_label5.label = ' InterChirpProcessingMargin (usec)';
                    templateObj.$.ti_widget_value5.label += MyUtil.sprintf(Params.interChirpProcessingMargin[subFrameNum], 4) + sep;
                    templateObj.$.ti_widget_label8.label = ' TransmitOutputTime (usec)';
                    templateObj.$.ti_widget_value8.label += MyUtil.sprintf(Params.transmitOutputTime[subFrameNum], 4) + sep;
                    templateObj.$.ti_widget_label9.label = ' Active/Interframe CPU Load (%)';
                    templateObj.$.ti_widget_value9.label += MyUtil.sprintf(Params.activeFrameCPULoad[subFrameNum], 4) + '/' + MyUtil.sprintf(Params.interFrameCPULoad[subFrameNum], 4) + sep;
                    addItem = 7;
                }
            }
            showitem += addItem;
        }
    }
    for (var idx = 1; idx <= 9; idx++) {
        templateObj.$['ti_widget_label' + idx].style.display = idx <= showitem ? 'block' : 'none';
        templateObj.$['ti_widget_value' + idx].style.display = idx <= showitem ? 'block' : 'none';
    }
};

var cmd_sender_listener = {
    // callback uses typical signature: function(error result)

    setCfg: function (cfg, sendCmd, clearConsole, callback) {
        // this is used for 3 cases: sending cfg commands, sensorStop, sensorStart 0 
        this.myCfg = []; // keep non-empty lines
        for (var idx = 0; idx < cfg.length; idx++) {
            var s = cfg[idx].trim();
            //if (s.length >= 1 && s[0] === '%') continue;
            if (s.length > 0) this.myCfg.push(s);
        }
        // TODO Do I need to prepend sensorStop and flushCfg if not found?
        this.myCallback = callback;
        this.myCmdIdx = 0;
        this.sendCmd = sendCmd;
        this.mode = 'setCfg';
        if (clearConsole) this.clearConsole();
        this.issueCmd();
    },
    askVersion: function (callback) {
        this.myCallback = callback;
        this.versionMessage = '';
        this.mode = 'askVersion';
        templateObj.$.CFG_port.sendValue('version');
    },
    clearConsole: function () {
        templateObj.$.ti_widget_textbox_cfg_console.value = '';
    },
    appendConsole: function (msg) {
        if (templateObj.$.ti_widget_textbox_cfg_console.value.length > 10000)
            this.clearConsole();
        if (templateObj.$.ti_widget_textbox_cfg_console.value.length > 0)
            templateObj.$.ti_widget_textbox_cfg_console.value += '\n' + msg;
        else
            templateObj.$.ti_widget_textbox_cfg_console.value = msg;
        templateObj.$.ti_widget_textbox_cfg_console.scrollTop = 999999;
    },
    issueCmd: function () {
        if (this.myCfg && this.myCmdIdx < this.myCfg.length && this.sendCmd) {
            templateObj.$.CFG_port.sendValue(this.myCfg[this.myCmdIdx]);
        } else {
            this.callback(true);
        }
    },
    callback: function (end, error, result) {
        if (end) this.mode = '';
        if (this.myCallback) {
            this.myCallback(error, result);
        }
    },
    onDataReceived: function (data) {
        if (!data) return;
        // expect \r\n  or \n as delimters.  \n\r is strange. The gc backplane delimits by \n, which is good.
        if (this.mode == 'askVersion') {
            if (data == 'Done' || data == '\rDone') {// I see \rDone for apr 13 firmware
                templateObj.$.ti_widget_statusbar.statusString3 = '';
                var deviceInfo = this.versionMessage.match(/Device Info\s*:\s*(.*)/);
                var platform = this.versionMessage.match(/Platform\s*:\s*(.*)/);
                if (deviceInfo != null) {
                    templateObj.$.ti_widget_statusbar.statusString3 = deviceInfo[1];
                } else {
                    if (platform != null) {
                        templateObj.$.ti_widget_statusbar.statusString3 = platform[1];
                    }
                }
                this.callback(true, null, this.versionMessage);
            } else {
                if (this.versionMessage.length == 0 && data.endsWith('version')) {
                    // this looks like echoing the command send out, so ignore it
                } else this.versionMessage += data;
            }
        } else {
            //we want all text coming from EVM to be displayed here, for instance assert information coming
            //from EVM is displayed
            this.appendConsole(data);
            if (this.mode == 'setCfg') {
                if (data == 'Skipped' || data == 'Done' || data == '\rDone') {
                    this.myCmdIdx = this.myCmdIdx + 1;
                    this.issueCmd();
                } else if (data.indexOf('Error ') >= 0) {
                    this.callback(true, data);
                }
            }
        }
    },
};

//This function get the values from slider and calculate Aggregated frames based on timeinterval.
function scatterDisplayTime (){
    var val = templateObj.$.ti_widget_slider_scatter_plot_display_time.value * 1000;
    var framePeriodicity = Params.frameCfg.framePeriodicity;
    templateObj.$.ti_widget_container_scatter_slider.visible=true;
    var aggFrames = Math.round(val/framePeriodicity);
    var detected_objects_list = Array(aggFrames).fill(0);
    Params.scatter_data.frameNumList = Array(aggFrames).fill(0);
    Params.scatter_data.det_obj_list = Array(aggFrames).fill(0);
    Params.scatter_data.x_coord = [];
    Params.scatter_data.y_coord = [];
    Params.scatter_data.z_coord = [];
    
    /*If we are aggregating frames, colormap must be disabled as we do not accumulate the
      intensity/velocity info for the aggregated frames. */
    if(aggFrames > 1)
    {
        templateObj.$.ti_widget_container_scatterplot_colormap.visible = false;
        templateObj.$.ti_widget_droplist_scatter_colormap.selectedValue = 1;
    }
    else
    {
        templateObj.$.ti_widget_container_scatterplot_colormap.visible = true;
    }
};