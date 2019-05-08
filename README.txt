
INSTRUCTIONS:
1. Place folder "chalmers_thesis" into C directory
2. Donwload and install mmWaveVisualizer from "https://dev.ti.com/gallery/info/mmwave/mmWave_Demo_Visualizer//" or from "https://github.com/ruslanmasinjila/mmWaveVisualizer"
3. Replace mmWave.js found in "guicomposer\runtime\gcruntime.v7\mmWave_Demo_Visualizer\app" with the one found in "C:\chalmers_thesis\mmWave_template"
4. Import and activate anaconda environment found in "C:\chalmers_thesis\anaconda_environment" 
5. Launch GUI found in "C:\chalmers_thesis\JAVA_GUI\dist"
6. Press "Launch Server" on Java GUI
7. Run mmWave Visualizer
8. Select Geture to record from the dropdown menu of the JAVA GUI
9. Click on "START CAPTURE" to start saving frames into C:\chalmers_thesis\data
10.Click on "STOP CAPTURE" to stop saving frames
---------------
Current Status
---------------
Version 1.1 [Complete]
- JAVA GUI Launches 2 python servers, 1 mmWaveVisualizer Client, and One Java client
- One of the python servers receives range-doppler heatmaps from mmWaveVisualizer Client and saves data.
- The other python server receives commands from Java Client


----------------------------------------
Version 1.2 [Complete]

- Preprocessing of captured frames into 128x128 features standardized to [0,1]
- Training data can be found at https://drive.google.com/drive/folders/1Fl0gFXouDYUSRcVearLVbsP_qxscS_Y1?usp=sharing
- Achieving accuracy of 0.27


----------------------------------------
Version 2.0 [Complete]
* Implemented Time distributed CNN followed by LSTM.
* The data format is as follows: [num_of_samples, frame_rate, num_of_doppler_bins, num_of_range_bins]
* Lines 29-31 convolves each frame of the "frame_rate" and flattens the result of the convolution
* Lines 36-45 is the LSTM layer containing learning and decay rates
* Achieving 1.0 Accuracy on validation set

################# SAMPLE OUTPUT #################

(5000, 16, 16, 64)
(16, 16, 64, 1)
Train on 4000 samples, validate on 1000 samples
Epoch 1/10
4000/4000 [==============================] - 34s 9ms/sample - loss: 0.8051 - acc: 0.6122 - val_loss: 0.0466 - val_acc: 0.9960
Epoch 2/10
4000/4000 [==============================] - 30s 7ms/sample - loss: 0.0772 - acc: 0.9760 - val_loss: 0.0133 - val_acc: 0.9960
Epoch 3/10
4000/4000 [==============================] - 29s 7ms/sample - loss: 0.0091 - acc: 0.9970 - val_loss: 5.8877e-07 - val_acc: 1.0000
Epoch 4/10
4000/4000 [==============================] - 31s 8ms/sample - loss: 0.0038 - acc: 0.9987 - val_loss: 1.3311e-06 - val_acc: 1.0000
Epoch 5/10
4000/4000 [==============================] - 31s 8ms/sample - loss: 0.0094 - acc: 0.9977 - val_loss: 2.9169 - val_acc: 0.7760
Epoch 6/10
4000/4000 [==============================] - 29s 7ms/sample - loss: 0.5048 - acc: 0.8313 - val_loss: 0.2479 - val_acc: 0.9890
Epoch 7/10
4000/4000 [==============================] - 29s 7ms/sample - loss: 0.2027 - acc: 0.9613 - val_loss: 5.5230e-07 - val_acc: 1.0000
Epoch 8/10
4000/4000 [==============================] - 30s 7ms/sample - loss: 0.0029 - acc: 0.9990 - val_loss: 6.0558e-07 - val_acc: 1.0000
Epoch 9/10
4000/4000 [==============================] - 28s 7ms/sample - loss: 0.0063 - acc: 0.9990 - val_loss: 3.5763e-07 - val_acc: 1.0000
Epoch 10/10
4000/4000 [==============================] - 31s 8ms/sample - loss: 2.1879e-04 - acc: 1.0000 - val_loss: 3.5763e-07 - val_acc: 1.0000

################################################

---------------------------------------
Version 2.1 [Unstable]
* A new client was added to python. This client will be sending classification results to GUI.
* Pretrained CNN-LSTM is loaded when python servers are launched
* It appears tensorflow crashes when launched straight from GUI. For now
Launch GUI from Netbeans, then launch python servers and mmwave visualizer from Spyder, finally connect to mmwave visualizer from GUI.

---------------------------------------
Version 2.2 [Stable]
* Spyder takes control over GUI and Everything else

---------------------------------------

Version 3.0 [Complete]
* Successfully implemented CNN- LTSM Neural Network using Keras.


---------------------------------------

Version 4.0 [Final release]
CNN-LSTM now works on Range Azimuth instead of Range Doppler

* CNN-LSTM Specs:
-------------------
* Dimensions of Range Azimuth images: 32 x 64
* Number of Frames per sequence: 16
* Number of Gestures: 5 [Stop, Turn Left, Turn Right, Move Forwards, Reverse]
* Training data per gesture: 1250.
* Total Training/validation data = 1250*5 = 6250
* Trained model saved as "model.h5" inside py_node sockets
* Reshaped Dimension for training: [6250, 16, 32, 64, 1]
* Reshaped Dimension of a single sequence: [1, 16,32, 64,1]



* MMWAVE Visualizer Specs:
---------------------------
* Version 2.0 sdk
* Device: awr1642
* Azimuth Resolutiom: 15 degrees
* Desirable configuration: Best Range Resolution
* Frequence bandwidth: 76-77 GHz
* Frame rate : 8 frames per second
* Plot Selection: Only Range Azimuth Heatmap selected.
* Real time tuning: SELECT "Remove Static Clutter" and DESELECT "Group peaks from same object" in both "Range" and "doppler" directions
 * Set CFAR and Doppler Range Threshold to 20dB
 * MAke sure you replace mmWave.js by the one found in mmWave Template




