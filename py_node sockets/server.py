import os
import socket
from threading import Thread
from datetime import datetime
import subprocess
import time
from killer import Killer
import numpy as np
import json
# Loads preTRained CNN-LSTM Neural Network
# Performs prediction
import tensorflow as tf
from tensorflow.keras.models import load_model



# Ports used
# 65432 is for listening to mmWave Visualizer
# 65431 is for listening to Java GUI

serverKiller=Killer()
class Server():

    def __init__(self):

        self.HOST = '127.0.0.1'
        self.visualizerPORT = 65432
        self.fromJavaGUIPORT = 65431
        self.rootDIR=r"C:\chalmers_thesis\data"
        self.frameNum=1
        self.frame_sequence=[]


        # 0 means don't capture
        # 1 means capture
        self.capture = 0
        self.start_recognition=0
        self.currentGesture = None

        # The folder containing capture frames
        # The folder name consists of gesture name and current time
        self.currentDirectory = ""
        
        self.frame_rate=16
        self.num_doppler_bins=16*2
        self.num_range_bins=64
        self.previous_result=99
        
        self.launchThreads()
        

        



    # For launching two servers
    def launchThreads(self):
        Thread(target = self.startVisualizerServer).start()
        Thread(target = self.startFromJavaGUIServer).start()
        Thread(target = self.makePrediction).start()
        time.sleep(2)
        subprocess.Popen(['java', '-jar', r'C:\chalmers_thesis\JAVA_GUI\dist\JAVA_GUI.jar'])
        subprocess.Popen(r"C:\Users\ruslan\guicomposer\runtime\gcruntime.v7\mmWave_Demo_Visualizer\launcher.exe")



    def startVisualizerServer(self):

        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            print("Listening to port:", self.visualizerPORT)
            s.bind((self.HOST, self.visualizerPORT))
            s.listen()
            conn, addr = s.accept()
            with conn:
                print("Connected By mmWave Visualizer")
                while True:
                    try:
                        data = conn.recv(65536)
                    except:
                        print("Crashed...")
                        break
                    if(self.capture==1):
                        file = open( self.currentDirectory + "\\frame" + str(self.frameNum) + '.txt', 'w' )
                        file.write(data.decode('utf-8'))
                        file.close()
                        self.frameNum=self.frameNum+1
                    if(self.start_recognition==1):
                        self.frame_sequence.append(np.nan_to_num(np.array(json.loads(data.decode('utf-8')),dtype="float")[0:self.num_doppler_bins,18:82]))
                        self.frame_sequence[-1]=(self.frame_sequence[-1]/(np.max(self.frame_sequence[-1]))).tolist()
                    if not data:
                        break

    def startFromJavaGUIServer(self):

        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            print("Listening to port:", self.fromJavaGUIPORT)
            s.bind((self.HOST, self.fromJavaGUIPORT))
            s.listen()
            conn, addr = s.accept()
            with conn:
                print("Connected By JAVA GUI")
                while True:
                    try:
                        data = conn.recv(65536)
                        data = data.decode('utf-8')
                    except:
                        print("Crashed...")
                        break
                    
                    # Create a folder with the name and
                    # time stamp of the gesture
                    if(data == "stop_capture"):
                        self.capture = 0
                        
                    elif(data=="start_recognition"):
                        self.start_recognition=1
                        self.capture=0
                        
                    elif(data=="stop_recognition"):
                        self.start_recognition=0

                    else:
                        self.frameNum = 1
                        self.capture = 1
                        self.start_recognition=0
                        self.currentGesture = data
                        # Create new folder using gesture name and current time
                        currentTime = datetime.now()
                        currentTime =   str(currentTime.year)+\
                                        str(currentTime.month)+\
                                        str(currentTime.day)+\
                                        str(currentTime.hour)+\
                                        str(currentTime.minute)+\
                                        str(currentTime.second)
                        
                        gesture_time = (self.currentGesture).replace(" ", "") +"_" + currentTime
                        self.currentDirectory = os.path.join(self.rootDIR, gesture_time)
                        os.mkdir(self.currentDirectory)
                    if not data:
                        break
    
    def makePrediction(self):

        ####################### LOAD PRETRAINED CNN-LSTM MODEL #######################
        model = load_model('model.h5')
        #self.model._make_predict_function()
        graph = tf.get_default_graph()
        print("Pretrained CNN-LSTM model loaded successfully")
        print("Summary of the model is as follows")
        print(model.summary())
        while(True):
            if(len(self.frame_sequence)>=self.frame_rate):
                sequence_to_predict=np.array(self.frame_sequence[-self.frame_rate:]).reshape(1,self.frame_rate,self.num_doppler_bins,self.num_range_bins,1)
                with graph.as_default():
                    result = model.predict_classes(sequence_to_predict)
                    if(len(result)>0):
                        if(result[0]==0 and self.previous_result!=0):
                            print("Stop")
                        if(result[0]==1 and self.previous_result!=1):
                            print("Move Forward")
                        if(result[0]==2 and self.previous_result!=2):
                            print("Turn Left")
                        if(result[0]==3 and self.previous_result!=3):
                            print("Turn Right")
                        if(result[0]==4 and self.previous_result!=4):
                            print("Reverse")
                    self.previous_result=result
                    time.sleep(1)
            #if(len(self.frame_sequence)>=100):
            #    del self.frame_sequence[0:-self.frame_rate]
if __name__ == "__main__":

    server = Server()