import json
import numpy as np
import seaborn as sns
import matplotlib.pylab as plt

# Raw frames are joined into sequences of 16 frames (about 2 seconds each)
# The sequences are then saved as samples for training

raw_data_folder=r"C:\chalmers_thesis\data\TurnRight_20195815550"
destination_data_folder=r"C:\training_data\turn_right"

frames=[]
prefix="\\frame"
frame_rate=16
num_doppler_bins=16*2
num_range_bins=64
start_index=1
end_index=1250+start_index+frame_rate




for i in range(start_index,end_index):
    frames.append(np.nan_to_num(np.array(json.load(open(raw_data_folder+prefix+str(i)+".txt")),dtype="float")[0:num_doppler_bins,18:82]))
    frames[-1]=((frames[-1])/(np.max(frames[-1]))).tolist()




for i in range(len(frames)-frame_rate):
    sequence=[]
    sequence.append(frames[i])
    sequence.append(frames[i+1])
    sequence.append(frames[i+2])
    sequence.append(frames[i+3])
    sequence.append(frames[i+4])
    sequence.append(frames[i+5])
    sequence.append(frames[i+6])
    sequence.append(frames[i+7])
    sequence.append(frames[i+8])
    sequence.append(frames[i+9])
    sequence.append(frames[i+10])
    sequence.append(frames[i+11])
    sequence.append(frames[i+12])
    sequence.append(frames[i+13])
    sequence.append(frames[i+14])
    sequence.append(frames[i+15])
    np.save(destination_data_folder+ "\\frame" + str(i),sequence)